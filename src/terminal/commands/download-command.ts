import type { Page } from "playwright";
import { startEngine } from "@/bridge-engine/bridge-engine.ts";
import { isSameChatGptConversation } from "@/providers/chatgpt/backend-api/chatgpt-conversation-url.ts";
import { downloadAll } from "@/providers/chatgpt/page/attachment-downloader.ts";
import { loadManifest } from "@/providers/chatgpt/page/attachment-manifest.ts";
import {
  extractAllMessages,
  registerConversationImages,
} from "@/providers/chatgpt/page/extract-messages.ts";
import { readProviderIdFrom } from "@/providers/providers.ts";
import { readAttachmentManifestsDirectory } from "@/repo-files/paths.ts";
import { fail } from "@/terminal/cli/cli-failure.ts";
import {
  DEBUG_PORT_FLAG,
  PORT_FLAG,
  parseAttachmentIds,
  parsePortFlag,
  readAbsolutePathFromOption,
  readConversationIdFromOption,
  readConversationUrlFromOption,
} from "@/terminal/cli/cli-option-readers.ts";
import type { DownloadCommandSettings, DownloadReport } from "@/terminal/cli/cli-types.ts";
import { readConversationIdFromPage, requireBrowserPage } from "@/terminal/cli/engine-session.ts";

async function navigateToConversationIfNeeded(details: {
  engine: Awaited<ReturnType<typeof startEngine>>;
  conversation?: string;
  page: Page;
}): Promise<void> {
  const conversation = details.conversation;

  const hasNoConversation = conversation == null || conversation === "";
  if (hasNoConversation) return;

  const targetUrl = readConversationUrlFromOption(conversation);
  if (isSameChatGptConversation(details.page.url(), targetUrl)) return;

  await Promise.allSettled([details.engine.getOrchestrator().navigateToConversation(targetUrl)]);
}

function assertDownloadProviderSupported(settings: DownloadCommandSettings): void {
  const isGeminiProvider = readProviderIdFrom(settings.provider) === "gemini";
  if (isGeminiProvider) {
    fail("Attachment download is not supported for Gemini web yet. Use ChatGPT for /download.");
  }
}

async function downloadConversationAttachments(details: {
  page: Page;
  conversationId: string;
  repoRoot: string;
  options: DownloadCommandSettings;
  manifestRoot: string;
}): Promise<DownloadReport[]> {
  const ids = parseAttachmentIds(details.options.id);

  const isOutFound = details.options.out != null && details.options.out !== "";
  const isIdsFound = ids != null;
  return downloadAll(details.page, details.conversationId, {
    repoRoot: details.repoRoot,
    manifestRoot: details.manifestRoot,
    ...(isOutFound ? { outDir: details.options.out } : {}),
    ...(isIdsFound ? { ids } : {}),
  });
}

function writeDownloadPrintout(reports: DownloadReport[], document?: boolean): void {
  const isDocument = document === true;
  if (isDocument) {
    process.stdout.write(`${JSON.stringify(reports)}\n`);
    return;
  }

  for (const download of reports) {
    const line = `${createDownloadLine(download)}
`;

    const isErrorFound = download.error != null && download.error !== "";
    if (isErrorFound) process.stderr.write(line);
    else process.stdout.write(line);
  }
}

export function createDownloadLine(report: DownloadReport): string {
  const isIdBlank = report.id == null || report.id === "";
  const label = isIdBlank ? "attachment" : report.id;

  const hasError = report.error != null;
  if (hasError) return `${label}: ${report.error}`;

  return `${label} -> ${report.path} (${report.bytes} bytes)`;
}

export async function runDownload(settings: DownloadCommandSettings): Promise<void> {
  assertDownloadProviderSupported(settings);
  const reports = await runDownloadFlow(settings);
  writeDownloadPrintout(reports, settings.json);
}

async function runDownloadFlow(settings: DownloadCommandSettings): Promise<DownloadReport[]> {
  const scope = await prepareDownloadScope(settings);
  const reports = await downloadAfterExtract(scope);
  await scope.engine.shutDown({ closeBrowser: false });
  return reports;
}

async function prepareDownloadScope(settings: DownloadCommandSettings) {
  const engine = await startDownloadEngine(settings);
  const page = requireBrowserPage(engine);

  return {
    engine,
    page,
    conversationId: downloadConversationId({ page, conversation: settings.conversation }),
    options: settings,
  };
}

function downloadConversationId(details: { page: Page; conversation: string | undefined }): string {
  const { page, conversation } = details;

  const isNotConversationGiven = conversation == null;
  if (isNotConversationGiven) return readConversationIdFromPage(page);

  return readConversationIdFromOption(conversation);
}

async function downloadAfterExtract(details: {
  page: Page;
  conversationId: string;
  options: DownloadCommandSettings;
  engine: Awaited<ReturnType<typeof startDownloadEngine>>;
}): Promise<DownloadReport[]> {
  const manifestRoot = readAttachmentManifestsDirectory();
  await navigateToConversationIfNeeded({
    engine: details.engine,
    conversation: details.options.conversation,
    page: details.page,
  });
  await extractAllMessages(details.page, { conversationId: details.conversationId, manifestRoot });
  await registerConversationImages({
    page: details.page,
    conversationId: details.conversationId,
    manifestRoot,
  });

  const isScan = details.options.scan === true;
  if (isScan) {
    const manifest = await loadManifest(details.conversationId, { manifestRoot });
    process.stderr.write(
      `Manifest refreshed: ${manifest.attachments.length} attachment(s) for ${details.conversationId}\n`,
    );
    return [];
  }

  return downloadConversationAttachments({
    ...details,
    repoRoot: details.engine.bridgeSettings.repoPath,
    manifestRoot,
  });
}

async function startDownloadEngine(settings: DownloadCommandSettings) {
  return startEngine({
    repoPath: readAbsolutePathFromOption(settings.repo),
    provider: readProviderIdFrom(settings.provider),
    mcpPort: parsePortFlag(PORT_FLAG, settings.port),
    withBrowser: true,
    withTools: false,
    persist: false,
    debugPort: parsePortFlag(DEBUG_PORT_FLAG, settings.debugPort),
    profileRoot: readAbsolutePathFromOption(settings.profile),
  });
}
