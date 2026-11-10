import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { type FanoutTask, FanoutTasksSchema } from "@/bridge/bridge-schemas.ts";
import { fanOutConversations } from "@/bridge/fanout.ts";
import { type FanoutReport, type FanoutSettings, isFanoutFailed } from "@/bridge/fanout-pool.ts";
import { type BridgeProviderId, DEFAULT_PROVIDER } from "@/config";
import type { ConversationSearchReport } from "@/conversation-catalog/conversation-catalog-schemas.ts";
import { listProviderIdsFrom, readProvider, readProviderIdFrom } from "@/providers/providers.ts";
import { readAttachmentManifestsDirectory } from "@/store/paths.ts";
import { fail, failUsage, readCliFailureMessage } from "@/terminal/cli-failure.ts";
import {
  convertSecondsToTimeoutMilliseconds,
  readNonNegativeIntegerFromOption,
  readPositiveIntegerFromOption,
} from "@/terminal/cli-option-readers.ts";
import type { AskSettings } from "@/terminal/cli-types.ts";
import { startAskEngine } from "@/terminal/engine-session.ts";

export const listProvidersOrFail = (spec: string | undefined): BridgeProviderId[] => {
  try {
    return listProviderIdsFrom(spec);
  } catch (error) {
    return fail(readCliFailureMessage(error));
  }
};

export const runFanOutAcrossProviders = async (details: {
  prompt: string;
  providers: BridgeProviderId[];
  options: AskSettings;
}): Promise<void> => {
  const tasks: FanoutTask[] = details.providers.map((provider) => ({
    prompt: details.prompt,
    provider,
  }));
  const firstProvider = details.providers[0] ?? DEFAULT_PROVIDER;

  await runFanOutAndReport({
    tasks,
    provider: firstProvider,
    options: details.options,
  });
};

export const runFanOutFromSettings = async (settings: AskSettings): Promise<void> => {
  const isFanOutMissing = settings.fanOut == null;
  const fanOutSpec = isFanOutMissing ? "" : settings.fanOut;
  const tasks = await loadFanoutTasks(fanOutSpec);

  await runFanOutAndReport({
    tasks,
    provider: readProviderIdFrom(settings.provider),
    options: settings,
  });
};

const readFanoutOrigin = async (spec: string): Promise<string> => {
  const trimmed = spec.trim();

  const isArrayNotation = trimmed.startsWith("[");
  if (isArrayNotation) return trimmed;

  const isAtMentionString = trimmed.startsWith("@");
  const path = isAtMentionString ? trimmed.slice(1) : trimmed;
  const absolute = isAbsolute(path) ? path : resolve(process.cwd(), path);
  return readFile(absolute, "utf8");
};

const loadFanoutTasks = async (spec: string): Promise<readonly FanoutTask[]> => {
  const isSpecBlank = !spec.trim();
  if (isSpecBlank) return failUsage("--fan-out needs a task file, @file, or inline JSON array.");

  const unparsed = await readFanoutOrigin(spec).catch((error: unknown) => {
    return fail(`--fan-out could not read ${spec}: ${readCliFailureMessage(error)}`);
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(unparsed);
  } catch (error) {
    return failUsage(`--fan-out is not valid JSON: ${readCliFailureMessage(error)}`);
  }
  try {
    return FanoutTasksSchema.parse(parsed);
  } catch (error) {
    return failUsage(
      `--fan-out does not match the task schema (need a non-empty array of {prompt, provider?, conversation?, label?, isolate?}): ${readCliFailureMessage(
        error,
      )}`,
    );
  }
};

interface FanoutRunDetails {
  readonly tasks: readonly FanoutTask[];
  readonly provider: BridgeProviderId;
  readonly options: AskSettings;
}

const runFanOutAndReport = async (details: FanoutRunDetails): Promise<void> => {
  const engine = await startAskEngine({
    options: { ...details.options, provider: details.provider },
    provider: details.provider,
    supportsMcpConnector: false,
  });

  const isFanoutRunFailed = await runFanOutOnEngine(engine, details);
  if (isFanoutRunFailed) throw new Error("Some fan-out tasks failed.");
};

const runFanOutOnEngine = async (
  engine: Awaited<ReturnType<typeof startAskEngine>>,
  details: FanoutRunDetails,
): Promise<boolean> => {
  try {
    const isEngineBrowserMissing = engine.browser == null;
    if (isEngineBrowserMissing) {
      return fail(
        `Browser not connected. Run \`bridge chrome start --provider ${details.provider}\` and sign in if needed.`,
      );
    }

    const fanoutReport = await fanOutConversations({
      browser: engine.browser,
      config: engine.config,
      tasks: details.tasks,
      manifestRoot: readAttachmentManifestsDirectory(),
      options: readFanoutSettingsFromAsk(details.options),
    });
    writeFanoutPrintout(fanoutReport, details.options);
    await Promise.allSettled([engine.shutDown({ closeBrowser: false })]);
    return isFanoutFailed(fanoutReport, Boolean(details.options.strict));
  } catch (error) {
    await Promise.allSettled([engine.shutDown({ closeBrowser: false })]);
    return fail(readCliFailureMessage(error));
  }
};

const readFanoutSettingsFromAsk = (settings: AskSettings): FanoutSettings => {
  const timeoutMs = convertSecondsToTimeoutMilliseconds(settings.timeout);
  const maxConcurrency = readPositiveIntegerFromOption(settings.maxConcurrency);
  const limit = readPositiveIntegerFromOption(settings.limit);
  const offset = readNonNegativeIntegerFromOption(settings.offset);
  const maxReplyChars = readPositiveIntegerFromOption(settings.maxReplyChars);
  const hasOffset = offset != null;

  return {
    ...(timeoutMs ? { timeoutMs } : {}),
    ...(maxConcurrency ? { maxConcurrency } : {}),
    ...(limit ? { limit } : {}),
    ...(hasOffset ? { offset } : {}),
    ...(maxReplyChars ? { maxReplyChars } : {}),
  };
};

const writeFanoutPrintout = (report: FanoutReport, settings: AskSettings): void => {
  if (settings.json) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return;
  }

  report.results.forEach((targetReport, index) => {
    const status = targetReport.ok ? "ok" : "error";
    const heading = createFanoutHeading({ row: targetReport, offset: report.offset, index });
    const target = readFanoutTargetLabel(targetReport.target);
    const truncated = targetReport.truncated ? `, truncated from ${targetReport.replyChars}` : "";
    const reportFields = createFanoutFields(targetReport);

    process.stdout.write(
      `=== ${heading} (${status}, ${targetReport.elapsedMs}ms${target}${truncated}) ===\n${reportFields}\n\n`,
    );
  });

  const hasMorePages = report.nextOffset != null;
  if (hasMorePages) {
    const remaining = report.total - report.offset - report.results.length;
    process.stdout.write(
      `… ${remaining} more task(s). Re-run with --offset ${report.nextOffset}.\n`,
    );
  }
};

const createFanoutHeading = (details: {
  row: FanoutReport["results"][number];
  offset: number;
  index: number;
}): string => {
  const label = details.row.label;
  const isLabelGiven = label != null && label !== "";
  if (isLabelGiven) return label;

  return `task ${details.offset + details.index + 1}`;
};

const readFanoutTargetLabel = (target: FanoutReport["results"][number]["target"]): string => {
  const isTargetMissing = target == null;
  if (isTargetMissing) return "";

  const isTargetIdMissing = target.id == null || target.id === "";
  if (isTargetIdMissing) return ` ${target.provider}`;

  return ` ${target.provider} ${target.id}`;
};

const createFanoutFields = (targetReport: FanoutReport["results"][number]): string => {
  if (targetReport.ok) {
    const targetReply = targetReport.reply;

    const hasNoReply = targetReply == null;
    if (hasNoReply) return "";

    return targetReply;
  }

  const targetError = targetReport.error;

  const hasNoError = targetError == null;
  if (hasNoError) return "";

  return targetError;
};

type ConversationSearchVerdict = {
  ok: boolean;
  results?: ConversationSearchReport[];
  error?: string;
  elapsedMs: number;
};

interface ReadFanoutConversationSearchDetails {
  providers: BridgeProviderId[];
  query: string;
  options: AskSettings;
  searchOptions?: { limit?: number };
}

export const readFanoutConversationSearch = async ({
  providers,
  query,
  options: settings,
  searchOptions: searchSettings = {},
}: ReadFanoutConversationSearchDetails): Promise<Record<string, ConversationSearchVerdict>> => {
  const verdicts = await Promise.all(
    providers.map(async (provider): Promise<readonly [string, ConversationSearchVerdict]> => {
      const started = Date.now();

      try {
        const searchReports = await searchOneProvider({
          provider,
          query,
          options: settings,
          searchOptions: searchSettings,
        });
        return [provider, { ok: true, results: searchReports, elapsedMs: Date.now() - started }];
      } catch (caughtError) {
        const error = readCliFailureMessage(caughtError);
        return [provider, { ok: false, error, elapsedMs: Date.now() - started }];
      }
    }),
  );

  return Object.fromEntries(verdicts);
};

interface SearchOneProviderDetails {
  provider: BridgeProviderId;
  query: string;
  options: AskSettings;
  searchOptions: { limit?: number };
}

const searchOneProvider = async ({
  provider,
  query,
  options: settings,
  searchOptions: searchSettings,
}: SearchOneProviderDetails): Promise<ConversationSearchReport[]> => {
  const browserProvider = readProvider(provider);
  const engine = await startAskEngine({
    options: { ...settings, provider },
    provider,
    supportsMcpConnector: false,
  });
  try {
    const browser = engine.browser;

    const isBrowserMissing = browser == null;
    if (isBrowserMissing) {
      throw new Error(
        `Browser not connected. Run \`bridge chrome start --provider ${provider}\` first.`,
      );
    }

    await browserProvider.assertSignedIn(browser.getPage());
    return await engine.getOrchestrator().searchConversations({
      query,
      limit: searchSettings.limit,
    });
  } finally {
    await Promise.allSettled([engine.shutDown({ closeBrowser: false })]);
  }
};
