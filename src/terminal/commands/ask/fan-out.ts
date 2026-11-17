import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { DEFAULT_PROVIDER } from "@/app-defaults.ts";
import { type FanOutTask, FanOutTasksSchema } from "@/bridge-engine/bridge-schemas.ts";
import type { ConversationSearchReport } from "@/conversation-catalog/conversation-catalog-schemas.ts";
import { fanOutConversations } from "@/fan-out/fan-out.ts";
import { type FanOutReport, type FanOutSettings, isFanOutFailed } from "@/fan-out/fan-out-pool.ts";
import type { BridgeProviderId } from "@/provider-settings.ts";
import { listProviderIdsFrom, readProvider, readProviderIdFrom } from "@/providers/providers.ts";
import { readErrorMessage } from "@/read-error-message.ts";
import { readAttachmentManifestsDirectory } from "@/repo-files/paths.ts";
import { fail, failUsage } from "@/terminal/cli/cli-failure.ts";
import {
  convertSecondsToTimeoutMilliseconds,
  readNonNegativeIntegerFromOption,
  readPositiveIntegerFromOption,
} from "@/terminal/cli/cli-option-readers.ts";
import type { AskSettings } from "@/terminal/cli/cli-types.ts";
import { startAskEngine } from "@/terminal/cli/engine-session.ts";

export function listProvidersOrFail(spec: string | undefined): BridgeProviderId[] {
  try {
    return listProviderIdsFrom(spec);
  } catch (error) {
    return fail(readErrorMessage(error));
  }
}

export async function runFanOutAcrossProviders(details: {
  prompt: string;
  providers: BridgeProviderId[];
  options: AskSettings;
}): Promise<void> {
  const tasks: FanOutTask[] = details.providers.map((provider) => ({
    prompt: details.prompt,
    provider,
  }));
  const firstProvider = details.providers[0] ?? DEFAULT_PROVIDER;

  await runFanOutAndReport({
    tasks,
    provider: firstProvider,
    options: details.options,
  });
}

export async function runFanOutFromSettings(settings: AskSettings): Promise<void> {
  const isFanOutMissing = settings.fanOut == null;
  const fanOutSpec = isFanOutMissing ? "" : settings.fanOut;
  const tasks = await loadFanOutTasks(fanOutSpec);

  await runFanOutAndReport({
    tasks,
    provider: readProviderIdFrom(settings.provider),
    options: settings,
  });
}

async function readFanOutOrigin(spec: string): Promise<string> {
  const trimmed = spec.trim();

  const isArrayNotation = trimmed.startsWith("[");
  if (isArrayNotation) return trimmed;

  const isAtMentionString = trimmed.startsWith("@");
  const path = isAtMentionString ? trimmed.slice(1) : trimmed;
  const absolute = isAbsolute(path) ? path : resolve(process.cwd(), path);
  return readFile(absolute, "utf8");
}

async function loadFanOutTasks(spec: string): Promise<readonly FanOutTask[]> {
  const isSpecBlank = !spec.trim();
  if (isSpecBlank) return failUsage("--fan-out needs a task file, @file, or inline JSON array.");

  const unparsed = await readFanOutOrigin(spec).catch((error: unknown) => {
    return fail(`--fan-out could not read ${spec}: ${readErrorMessage(error)}`);
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(unparsed);
  } catch (error) {
    return failUsage(`--fan-out is not valid JSON: ${readErrorMessage(error)}`);
  }
  try {
    return FanOutTasksSchema.parse(parsed);
  } catch (error) {
    return failUsage(
      `--fan-out does not match the task schema (need a non-empty array of {prompt, provider?, conversation?, label?, isolate?}): ${readErrorMessage(
        error,
      )}`,
    );
  }
}

interface FanOutRunDetails {
  readonly tasks: readonly FanOutTask[];
  readonly provider: BridgeProviderId;
  readonly options: AskSettings;
}

async function runFanOutAndReport(details: FanOutRunDetails): Promise<void> {
  const engine = await startAskEngine({
    options: { ...details.options, provider: details.provider },
    provider: details.provider,
    supportsMcpConnector: false,
  });

  const isFanOutRunFailed = await runFanOutOnEngine(engine, details);
  if (isFanOutRunFailed) throw new Error("Some fan-out tasks failed.");
}

async function runFanOutOnEngine(
  engine: Awaited<ReturnType<typeof startAskEngine>>,
  details: FanOutRunDetails,
): Promise<boolean> {
  try {
    const isEngineBrowserMissing = engine.browser == null;
    if (isEngineBrowserMissing) {
      return fail(
        `Browser not connected. Run \`bridge chrome start --provider ${details.provider}\` and sign in if needed.`,
      );
    }

    const fanOutReport = await fanOutConversations({
      browser: engine.browser,
      bridgeSettings: engine.bridgeSettings,
      tasks: details.tasks,
      manifestRoot: readAttachmentManifestsDirectory(),
      options: readFanOutSettingsFromAsk(details.options),
    });
    writeFanOutPrintout(fanOutReport, details.options);
    await Promise.allSettled([engine.shutDown({ closeBrowser: false })]);
    return isFanOutFailed(fanOutReport, Boolean(details.options.strict));
  } catch (error) {
    await Promise.allSettled([engine.shutDown({ closeBrowser: false })]);
    return fail(readErrorMessage(error));
  }
}

function readFanOutSettingsFromAsk(settings: AskSettings): FanOutSettings {
  const timeoutMilliseconds = convertSecondsToTimeoutMilliseconds(settings.timeout);
  const maxConcurrency = readPositiveIntegerFromOption(settings.maxConcurrency);
  const limit = readPositiveIntegerFromOption(settings.limit);
  const offset = readNonNegativeIntegerFromOption(settings.offset);
  const maxReplyChars = readPositiveIntegerFromOption(settings.maxReplyChars);
  const hasOffset = offset != null;

  const isTimeoutMillisecondsFound =
    timeoutMilliseconds != null && timeoutMilliseconds !== 0 && !Number.isNaN(timeoutMilliseconds);
  const isMaxConcurrencyFound =
    maxConcurrency != null && maxConcurrency !== 0 && !Number.isNaN(maxConcurrency);
  const isLimitFound = limit != null && limit !== 0 && !Number.isNaN(limit);
  const isMaxReplyCharsFound =
    maxReplyChars != null && maxReplyChars !== 0 && !Number.isNaN(maxReplyChars);
  return {
    ...(isTimeoutMillisecondsFound ? { timeoutMilliseconds: timeoutMilliseconds } : {}),
    ...(isMaxConcurrencyFound ? { maxConcurrency } : {}),
    ...(isLimitFound ? { limit } : {}),
    ...(hasOffset ? { offset } : {}),
    ...(isMaxReplyCharsFound ? { maxReplyChars } : {}),
  };
}

function writeFanOutPrintout(report: FanOutReport, settings: AskSettings): void {
  const isMachineReadable = settings.json;
  if (isMachineReadable) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return;
  }

  report.taskReports.forEach((targetReport, index) => {
    const isOk = targetReport.ok;
    const status = isOk ? "ok" : "error";
    const heading = createFanOutHeading({ row: targetReport, offset: report.offset, index });
    const target = readFanOutTargetLabel(targetReport.target);
    const isTruncated = targetReport.truncated === true;
    const truncated = isTruncated ? `, truncated from ${targetReport.replyChars}` : "";
    const reportFields = createFanOutFields(targetReport);

    process.stdout.write(
      `=== ${heading} (${status}, ${targetReport.elapsedMs}ms${target}${truncated}) ===\n${reportFields}\n\n`,
    );
  });

  const hasMorePages = report.nextOffset != null;
  if (hasMorePages) {
    const remaining = report.total - report.offset - report.taskReports.length;
    process.stdout.write(
      `… ${remaining} more task(s). Re-run with --offset ${report.nextOffset}.\n`,
    );
  }
}

function createFanOutHeading(details: {
  row: FanOutReport["taskReports"][number];
  offset: number;
  index: number;
}): string {
  const label = details.row.label;
  const isLabelGiven = label != null && label !== "";
  if (isLabelGiven) return label;

  return `task ${details.offset + details.index + 1}`;
}

function readFanOutTargetLabel(target: FanOutReport["taskReports"][number]["target"]): string {
  const isTargetMissing = target == null;
  if (isTargetMissing) return "";

  const isTargetIdMissing = target.id == null || target.id === "";
  if (isTargetIdMissing) return ` ${target.provider}`;

  return ` ${target.provider} ${target.id}`;
}

function createFanOutFields(targetReport: FanOutReport["taskReports"][number]): string {
  const isOk = targetReport.ok;
  if (isOk) {
    const targetReply = targetReport.reply;

    const hasNoReply = targetReply == null;
    if (hasNoReply) return "";

    return targetReply;
  }

  const targetError = targetReport.error;

  const hasNoError = targetError == null;
  if (hasNoError) return "";

  return targetError;
}

type ConversationSearchVerdict = {
  ok: boolean;
  results?: ConversationSearchReport[];
  error?: string;
  elapsedMs: number;
};

interface ReadFanOutConversationSearchDetails {
  providers: BridgeProviderId[];
  query: string;
  options: AskSettings;
  searchOptions?: { limit?: number };
}

export async function readFanOutConversationSearch({
  providers,
  query,
  options: settings,
  searchOptions: searchSettings = {},
}: ReadFanOutConversationSearchDetails): Promise<Record<string, ConversationSearchVerdict>> {
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
        const error = readErrorMessage(caughtError);
        return [provider, { ok: false, error, elapsedMs: Date.now() - started }];
      }
    }),
  );

  return Object.fromEntries(verdicts);
}

interface SearchOneProviderDetails {
  provider: BridgeProviderId;
  query: string;
  options: AskSettings;
  searchOptions: { limit?: number };
}

async function searchOneProvider({
  provider,
  query,
  options: settings,
  searchOptions: searchSettings,
}: SearchOneProviderDetails): Promise<ConversationSearchReport[]> {
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
}
