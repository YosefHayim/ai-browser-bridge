import { readFile } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, resolve } from "node:path";
import { Schema } from "effect";
import type { Page } from "playwright";
import { type BridgeProviderId, DEFAULT_PROVIDER } from "@/config.ts";
import { startEngine } from "@/features/bridge/engine/bridgeEngine.ts";
import { type FanoutTask, FanoutTasksSchema } from "@/features/bridge/engine/bridgeSchemas.ts";
import { fanOutConversations } from "@/features/bridge/fanout/runBrowserConversations.ts";
import {
  type FanoutOptions,
  type FanoutResult,
  fanoutFailed,
} from "@/features/bridge/fanout/runConversationTasks.ts";
import { attachmentManifestsDir, repositoryPath } from "@/features/repoState/paths.ts";
import { listSessions } from "@/features/repoState/sessions.ts";
import {
  chatGptConversationUrlFromIdOrUrl,
  isSameChatGptConversation,
} from "@/features/webProviders/chatgpt/chatgptConversationUrl.ts";
import {
  providerIdFrom,
  providerIdsFrom,
  webProviderFor,
} from "@/features/webProviders/providerRegistry.ts";
import {
  assertSignedIn,
  debugPortFromOption,
  profileRootFromOption,
} from "../browser/browserConnection.ts";
import type { AskOptions } from "../presentation/cliTypes.ts";
import { exitWithCliError } from "../presentation/commandOutput.ts";
import { abortAndExit, timeoutMsFromSeconds } from "../presentation/commandSession.ts";

type RepositoryFileInput = {
  repoRoot: string;
  input: string;
};

type WriteAskOutputContext = {
  engine: Awaited<ReturnType<typeof startEngine>>;
  reply: Awaited<ReturnType<Awaited<ReturnType<typeof startEngine>>["ask"]>>;
  conversationError: string | null;
  options: AskOptions;
  provider: ReturnType<typeof providerIdFrom>;
  displayName: string;
};

type StartAskEngineInput = {
  options: AskOptions;
  provider: ReturnType<typeof providerIdFrom>;
  supportsMcpConnector: boolean;
};

const repositoryFileFrom = (params: RepositoryFileInput): string => {
  if (isAbsolute(params.input)) {
    const rel = relative(resolve(params.repoRoot), resolve(params.input));
    if (rel.length === 0) return repositoryPath(params.repoRoot, ".");
    return repositoryPath(params.repoRoot, rel);
  }
  return repositoryPath(params.repoRoot, params.input);
};

const assertImagePath = (path: string): void => {
  const extension = extname(path).toLowerCase();
  if (![".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(extension)) {
    throw new Error(`Unsupported image type: ${basename(path)}`);
  }
};

export const runSessions = async (): Promise<void> => {
  const sessions = await listSessions();
  process.stdout.write(`${JSON.stringify(sessions, null, 2)}\n`);
  process.exit(0);
};

// Prefer the real conversation error over a generic "not logged in" hint.
const writeAskOutput = (askOutput: WriteAskOutputContext): void => {
  if (!askOutput.reply) {
    const fallbackHint = `No reply captured — ${askOutput.displayName} may not be logged in, or the page UI changed. Try \`bridge chrome start --provider ${askOutput.provider}\`.`;
    exitWithCliError(
      askOutput.conversationError === null ? fallbackHint : askOutput.conversationError,
    );
    return;
  }
  if (askOutput.options.json) {
    process.stdout.write(
      `${JSON.stringify({
        sessionId: askOutput.engine.sessionId,
        model: askOutput.engine.getBrowserConversation().model,
        reply: askOutput.reply.content,
        contextTokens: askOutput.engine.counter.count,
      })}\n`,
    );
    return;
  }
  process.stdout.write(`${askOutput.reply.content}\n`);
};

export const runAsk = async (prompt: string, options: AskOptions): Promise<void> => {
  if (options.fanOut) return runFanoutSource(options);
  if (!prompt.trim()) {
    return exitWithCliError(
      'Provide a prompt (e.g. `bridge ask "hi"`) or a task file via --fan-out.',
    );
  }
  const providers = providerListOrFail(options.provider);
  if (providers.length > 1) {
    return fanOutPromptAcrossProviders({
      prompt: prompt,
      providers,
      options: options,
    });
  }
  const setup = await prepareAskRun(options);
  const captured = captureBrowserConversationError(setup.engine);
  const reply = await runAskTurn({
    engine: setup.engine,
    prompt: prompt,
    options: options,
  });
  await finishAskRun({
    setup,
    reply,
    conversationError: captured.lastError(),
    options: options,
  });
};

const providerListOrFail = (spec: string | undefined): BridgeProviderId[] => {
  try {
    return providerIdsFrom(spec);
  } catch (err) {
    return exitWithCliError(err instanceof Error ? err.message : String(err));
  }
};

const fanOutPromptAcrossProviders = async (input: {
  prompt: string;
  providers: BridgeProviderId[];
  options: AskOptions;
}): Promise<void> => {
  const tasks: FanoutTask[] = input.providers.map((provider) => ({
    prompt: input.prompt,
    provider,
  }));
  await runFanoutAndReport({
    tasks,
    provider: input.providers[0] === undefined ? DEFAULT_PROVIDER : input.providers[0],
    options: input.options,
  });
};

const runFanoutSource = async (options: AskOptions): Promise<void> => {
  const fanOutSpec = options.fanOut === undefined ? "" : options.fanOut;
  const tasks = await loadFanoutTasks(fanOutSpec);
  await runFanoutAndReport({ tasks, provider: providerIdFrom(options.provider), options });
};

const readFanoutSource = async (spec: string): Promise<string> => {
  const trimmed = spec.trim();
  if (trimmed.startsWith("[")) return trimmed;
  const path = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  const absolute = isAbsolute(path) ? path : resolve(process.cwd(), path);
  return readFile(absolute, "utf8");
};

const loadFanoutTasks = async (spec: string): Promise<readonly FanoutTask[]> => {
  if (!spec.trim())
    return exitWithCliError("--fan-out needs a task file, @file, or inline JSON array.");
  const raw = await readFanoutSource(spec).catch((err: unknown) =>
    exitWithCliError(
      `--fan-out could not read ${spec}: ${err instanceof Error ? err.message : String(err)}`,
    ),
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return exitWithCliError(
      `--fan-out is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  try {
    return Schema.decodeUnknownSync(FanoutTasksSchema)(parsed);
  } catch (err) {
    return exitWithCliError(
      `--fan-out does not match the task schema (need a non-empty array of {prompt, provider?, conversation?, label?, isolate?}): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
};

const runFanoutAndReport = async (input: {
  tasks: readonly FanoutTask[];
  provider: BridgeProviderId;
  options: AskOptions;
}): Promise<void> => {
  const engine = await startAskEngine({
    options: { ...input.options, provider: input.provider },
    provider: input.provider,
    supportsMcpConnector: false,
  });
  try {
    if (!engine.browser) {
      return exitWithCliError(
        `Browser not connected. Run \`bridge chrome start --provider ${input.provider}\` and sign in if needed.`,
      );
    }
    const fanoutResult = await fanOutConversations({
      browser: engine.browser,
      config: engine.config,
      tasks: input.tasks,
      manifestRoot: attachmentManifestsDir(),
      options: fanoutOptionsFromAsk(input.options),
    });
    writeFanoutOutput(fanoutResult, input.options);
    await Promise.allSettled([engine.shutdown({ closeBrowser: false })]);
    process.exit(fanoutFailed(fanoutResult, Boolean(input.options.strict)) ? 1 : 0);
  } catch (err) {
    await Promise.allSettled([engine.shutdown({ closeBrowser: false })]);
    return exitWithCliError(err instanceof Error ? err.message : String(err));
  }
};

const positiveIntFromOption = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const nonNegativeIntFromOption = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

const fanoutOptionsFromAsk = (options: AskOptions): FanoutOptions => {
  const timeoutMs = timeoutMsFromSeconds(options.timeout);
  const maxConcurrency = positiveIntFromOption(options.maxConcurrency);
  const limit = positiveIntFromOption(options.limit);
  const offset = nonNegativeIntFromOption(options.offset);
  const maxReplyChars = positiveIntFromOption(options.maxReplyChars);
  return {
    ...(timeoutMs ? { timeoutMs } : {}),
    ...(maxConcurrency ? { maxConcurrency } : {}),
    ...(limit ? { limit } : {}),
    ...(offset !== undefined ? { offset } : {}),
    ...(maxReplyChars ? { maxReplyChars } : {}),
  };
};

const writeFanoutOutput = (fanoutResult: FanoutResult, options: AskOptions): void => {
  if (options.json) {
    process.stdout.write(`${JSON.stringify(fanoutResult)}\n`);
    return;
  }
  fanoutResult.results.forEach((conversationResult, index) => {
    const status = conversationResult.ok ? "ok" : "error";
    const heading = fanoutRowHeading({
      row: conversationResult,
      offset: fanoutResult.offset,
      index,
    });
    const target = fanoutTargetLabel(conversationResult.target);
    const truncated = conversationResult.truncated
      ? `, truncated from ${conversationResult.replyChars}`
      : "";
    const rowBody = fanoutRowBody(conversationResult);
    process.stdout.write(
      `=== ${heading} (${status}, ${conversationResult.elapsedMs}ms${target}${truncated}) ===\n${rowBody}\n\n`,
    );
  });
  if (fanoutResult.nextOffset !== null) {
    const remaining = fanoutResult.total - fanoutResult.offset - fanoutResult.results.length;
    process.stdout.write(
      `… ${remaining} more task(s). Re-run with --offset ${fanoutResult.nextOffset}.\n`,
    );
  }
};

const fanoutRowHeading = (input: {
  row: FanoutResult["results"][number];
  offset: number;
  index: number;
}): string => {
  if (input.row.label !== undefined && input.row.label !== "") return input.row.label;
  return `task ${input.offset + input.index + 1}`;
};

const fanoutTargetLabel = (target: FanoutResult["results"][number]["target"]): string => {
  if (target === null) return "";
  if (target.id === null || target.id === "") return ` ${target.provider}`;
  return ` ${target.provider} ${target.id}`;
};

const fanoutRowBody = (conversationResult: FanoutResult["results"][number]): string => {
  if (conversationResult.ok) {
    if (conversationResult.reply === undefined) return "";
    return conversationResult.reply;
  }
  if (conversationResult.error === undefined) return "";
  return conversationResult.error;
};

// Capture conversation errors so a null reply can report the real failure.
const captureBrowserConversationError = (
  engine: Awaited<ReturnType<typeof startEngine>>,
): {
  lastError: () => string | null;
} => {
  let lastError: string | null = null;
  engine.getBrowserConversation().on((event) => {
    if (event.type === "error") lastError = event.error;
  });
  return { lastError: () => lastError };
};

const prepareAskRun = async (options: AskOptions) => {
  const providers = askProvidersFrom(options);
  const engine = await startAskEngine({
    options,
    provider: providers.provider,
    supportsMcpConnector: providers.browserProvider.supportsMcpConnector,
  });
  registerAskSignalHandlers(engine);
  await assertSignedIn(engine, providers.browserProvider, providers.provider);
  return { engine, ...providers };
};

const askProvidersFrom = (options: AskOptions) => {
  const provider = providerIdFrom(options.provider);
  return { provider, browserProvider: webProviderFor(provider) };
};

const finishAskRun = async (input: {
  setup: Awaited<ReturnType<typeof prepareAskRun>>;
  reply: Awaited<ReturnType<Awaited<ReturnType<typeof startEngine>>["ask"]>>;
  conversationError: string | null;
  options: AskOptions;
}): Promise<void> => {
  await input.setup.engine.shutdown({ closeBrowser: false });
  writeAskOutput({
    engine: input.setup.engine,
    reply: input.reply,
    conversationError: input.conversationError,
    options: input.options,
    provider: input.setup.provider,
    displayName: input.setup.browserProvider.displayName,
  });
  process.exit(0);
};

export const startAskEngine = async (input: StartAskEngineInput) => {
  const withTools = Boolean(input.options.tools) && input.supportsMcpConnector;
  return startEngine({
    repoPath: input.options.repo ? resolve(input.options.repo) : undefined,
    provider: input.provider,
    mcpPort: input.options.port ? Number(input.options.port) : undefined,
    withBrowser: true,
    withTools,
    persist: withTools,
    debugPort: debugPortFromOption(input.options.debugPort),
    profileRoot: profileRootFromOption(input.options.profile),
  });
};

const registerAskSignalHandlers = (engine: Awaited<ReturnType<typeof startEngine>>): void => {
  process.once("SIGINT", () => void abortAndExit(engine, 130, process.exit));
  process.once("SIGTERM", () => void abortAndExit(engine, 143, process.exit));
};

const imageCountFromOption = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const runAskTurn = async (input: {
  engine: Awaited<ReturnType<typeof startEngine>>;
  prompt: string;
  options: AskOptions;
}) => {
  await applyAskPreflight({ engine: input.engine, options: input.options });
  await attachAskFiles({ engine: input.engine, options: input.options });
  return input.engine.ask({
    content: input.prompt,
    timeoutMs: timeoutMsFromSeconds(input.options.timeout),
    expectImages: imageCountFromOption(input.options.images),
  });
};

const attachAskFiles = async (input: {
  engine: Awaited<ReturnType<typeof startEngine>>;
  options: AskOptions;
}): Promise<void> => {
  const paths = input.options.attach;
  if (!paths?.length) return;
  const repoRoot = input.engine.config.repoPath;
  const resolved = paths.map((target) => {
    const rel = repositoryFileFrom({ repoRoot, input: target });
    assertImagePath(rel);
    return resolve(repoRoot, rel);
  });
  await input.engine.getBrowserConversation().attachFiles(resolved);
};

const conversationUrlFromOption = (value: string): string => {
  return chatGptConversationUrlFromIdOrUrl(value);
};

export const navigateToConversationIfNeeded = async (input: {
  engine: Awaited<ReturnType<typeof startEngine>>;
  conversation?: string;
  page: Page;
}): Promise<void> => {
  if (!input.conversation) return;
  const targetUrl = conversationUrlFromOption(input.conversation);
  if (isSameChatGptConversation(input.page.url(), targetUrl)) return;
  await Promise.allSettled([
    input.engine.getBrowserConversation().navigateToConversation(targetUrl),
  ]);
};

const applyAskPreflight = async (input: {
  engine: Awaited<ReturnType<typeof startEngine>>;
  options: AskOptions;
}): Promise<void> => {
  if (input.options.fresh)
    await Promise.allSettled([input.engine.getBrowserConversation().newConversation()]);
  else if (input.options.conversation) {
    await Promise.allSettled([
      input.engine
        .getBrowserConversation()
        .navigateToConversation(conversationUrlFromOption(input.options.conversation)),
    ]);
  }
  if (input.options.model)
    await Promise.allSettled([
      input.engine.getBrowserConversation().switchModel(input.options.model),
    ]);
};
