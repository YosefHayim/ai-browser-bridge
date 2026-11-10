import { resolve } from "node:path";
import type { BridgeEngine } from "@/bridge/bridge-engine.ts";
import {
  readConversationIdForProviderUrl,
  readProvider,
  readProviderIdFrom,
} from "@/providers/providers.ts";
import { fail, failUsage, readCliFailureMessage } from "@/terminal/cli-failure.ts";
import {
  convertSecondsToTimeoutMilliseconds,
  readConversationUrlFromOption,
  readImageCountFromOption,
} from "@/terminal/cli-option-readers.ts";
import type { AskSettings } from "@/terminal/cli-types.ts";
import { stopEngine } from "@/terminal/engine-commands.ts";
import { assertSignedIn, requireBrowserPage, startAskEngine } from "@/terminal/engine-session.ts";
import { assertImagePath, createRepositoryFilePath } from "@/terminal/repository-file-paths.ts";
import { addStopOnInterrupt } from "@/terminal/user-interrupt.ts";
import { listProvidersOrFail, runFanOutAcrossProviders, runFanOutFromSettings } from "./fan-out.ts";

type AskedChat = { conversationId: string | null; url: string };

type WriteAskPrintoutScope = {
  engine: BridgeEngine;
  askedChat: AskedChat;
  reply: Awaited<ReturnType<BridgeEngine["ask"]>>;
  orchestratorError: string | null;
  options: AskSettings;
  provider: ReturnType<typeof readProviderIdFrom>;
  displayName: string;
};

// Prefer the real orchestrator error over a generic "not logged in" hint.
const writeAskPrintout = (commandSession: WriteAskPrintoutScope): void => {
  const reply = commandSession.reply;

  const hasNoReply = reply == null;
  if (hasNoReply) {
    const fallbackHint = `No reply captured — ${commandSession.displayName} may not be logged in, or the page UI changed. Try \`bridge chrome start --provider ${commandSession.provider}\`.`;
    fail(commandSession.orchestratorError ?? fallbackHint);
    return;
  }

  const isMachineReadable = commandSession.options.json;
  if (isMachineReadable) {
    process.stdout.write(
      `${JSON.stringify({
        sessionId: commandSession.engine.sessionId,
        model: commandSession.engine.getOrchestrator().model,
        reply: reply.content,
        contextTokens: commandSession.engine.counter.count,
        conversationId: commandSession.askedChat.conversationId,
        url: commandSession.askedChat.url,
      })}\n`,
    );
    return;
  }

  process.stdout.write(`${reply.content}\n`);
};

const runAskFlow = async (details: { prompt: string; options: AskSettings }): Promise<void> => {
  const isFanOutFound = details.options.fanOut != null && details.options.fanOut !== "";
  if (isFanOutFound) return runFanOutFromSettings(details.options);

  const isPromptBlank = !details.prompt.trim();
  if (isPromptBlank) {
    return failUsage('Provide a prompt (e.g. `bridge ask "hi"`) or a task file via --fan-out.');
  }

  const providers = listProvidersOrFail(details.options.provider);

  const hasManyProviders = providers.length > 1;
  if (hasManyProviders) {
    return runFanOutAcrossProviders({
      prompt: details.prompt,
      providers,
      options: details.options,
    });
  }

  const setup = await prepareAskRun(details.options);
  const captured = captureOrchestratorError(setup.engine);
  const reply = await askEngineTurn({
    engine: setup.engine,
    prompt: details.prompt,
    options: details.options,
  });
  await finishAskRun({
    setup,
    reply,
    orchestratorError: captured.lastError(),
    options: details.options,
  });
};

// Capture orchestrator errors so a null reply can report the real failure.
const captureOrchestratorError = (
  engine: BridgeEngine,
): {
  lastError: () => string | null;
} => {
  let lastError: string | null = null;

  engine.getOrchestrator().subscribe((event) => {
    const isEventTypeError = event.type === "error";
    if (isEventTypeError) lastError = event.error;
  });

  return { lastError: () => lastError };
};

const prepareAskRun = async (settings: AskSettings) => {
  const providers = pickAskProvider(settings);
  const engine = await startAskEngine({
    options: settings,
    provider: providers.provider,
    supportsMcpConnector: providers.browserProvider.supportsMcpConnector,
  });

  addStopOnInterrupt(() => stopEngine(engine));
  await assertSignedIn(engine, providers.browserProvider, providers.provider);

  return { engine, ...providers };
};

const pickAskProvider = (settings: AskSettings) => {
  const provider = readProviderIdFrom(settings.provider);
  return { provider, browserProvider: readProvider(provider) };
};

const finishAskRun = async (details: {
  setup: Awaited<ReturnType<typeof prepareAskRun>>;
  reply: Awaited<ReturnType<BridgeEngine["ask"]>>;
  orchestratorError: string | null;
  options: AskSettings;
}): Promise<void> => {
  const askedChat = readAskedChat(details.setup);

  await details.setup.engine.shutDown({ closeBrowser: false });
  writeAskPrintout({
    engine: details.setup.engine,
    askedChat,
    reply: details.reply,
    orchestratorError: details.orchestratorError,
    options: details.options,
    provider: details.setup.provider,
    displayName: details.setup.browserProvider.displayName,
  });
};

const readAskedChat = (setup: Awaited<ReturnType<typeof prepareAskRun>>): AskedChat => {
  const url = requireBrowserPage(setup.engine).url();
  const conversationId = readConversationIdForProviderUrl({ providerId: setup.provider, url });
  return { conversationId, url };
};

const askEngineTurn = async (details: {
  engine: BridgeEngine;
  prompt: string;
  options: AskSettings;
}) => {
  await applyAskPreflight({ engine: details.engine, options: details.options });
  await attachAskFiles({ engine: details.engine, options: details.options });

  return details.engine.ask({
    content: details.prompt,
    timeoutMilliseconds: convertSecondsToTimeoutMilliseconds(details.options.timeout),
    expectImages: readImageCountFromOption(details.options.images),
  });
};

const attachAskFiles = async (details: {
  engine: BridgeEngine;
  options: AskSettings;
}): Promise<void> => {
  // Runs even without --attach, so files left in the composer by a failed ask never ride along.
  const paths = details.options.attach ?? [];
  const repoRoot = details.engine.config.repoPath;
  const absolutePaths = paths.map((target) => {
    const rel = createRepositoryFilePath({ repoRoot, input: target });
    assertImagePath(rel);
    return resolve(repoRoot, rel);
  });

  await details.engine.getOrchestrator().attachFiles(absolutePaths);
};

export const runAsk = async (prompt: string, settings: AskSettings): Promise<void> => {
  await runAskFlow({ prompt, options: settings });
};

interface AskPreflight {
  engine: BridgeEngine;
  options: AskSettings;
}

const openFreshConversation = async (engine: BridgeEngine): Promise<void> => {
  try {
    await engine.getOrchestrator().openNewConversation();
  } catch (error) {
    const reason = readCliFailureMessage(error);
    throw new Error(`Could not open a new conversation: ${reason}`, { cause: error });
  }
};

const openRequestedConversation = async (
  engine: BridgeEngine,
  conversation: string,
): Promise<void> => {
  const conversationUrl = readConversationUrlFromOption(conversation);
  try {
    await engine.getOrchestrator().navigateToConversation(conversationUrl);
  } catch (error) {
    const reason = readCliFailureMessage(error);
    throw new Error(`Could not open conversation "${conversation}": ${reason}`, { cause: error });
  }
};

export const applyAskPreflight = async (preflight: AskPreflight): Promise<void> => {
  const isFreshRequested = preflight.options.fresh === true;
  if (isFreshRequested) await openFreshConversation(preflight.engine);

  const conversation = preflight.options.conversation;
  const isConversationRequested = conversation != null && conversation !== "";
  // --fresh wins over --conversation, as it always has.
  const isConversationToOpen = isConversationRequested && !isFreshRequested;
  if (isConversationToOpen) await openRequestedConversation(preflight.engine, conversation);

  const model = preflight.options.model;

  const isModelEmpty = model == null || model === "";
  if (isModelEmpty) return;

  try {
    await preflight.engine.getOrchestrator().switchModel(model);
  } catch (error) {
    const reason = readCliFailureMessage(error);
    throw new Error(`Could not switch to model "${model}": ${reason}`, { cause: error });
  }
};
