import { resolve } from "node:path";
import type { Page } from "playwright";
import { startEngine } from "@/features/bridge/engine/bridgeEngine.ts";
import { attachmentManifestsDir } from "@/features/repoState/paths.ts";
import { chatGptConversationIdFromUrl } from "@/features/webProviders/chatgpt/chatgptConversationUrl.ts";
import {
  downloadAll,
  extractAllMessages,
  loadManifest,
} from "@/features/webProviders/chatgpt/content/chatgptAttachments.ts";
import { providerIdFrom } from "@/features/webProviders/providerRegistry.ts";
import {
  debugPortFromOption,
  profileRootFromOption,
  requireBrowserPage,
} from "../browser/browserConnection.ts";
import type { DownloadCmdOptions, DownloadResult } from "../presentation/cliTypes.ts";
import { exitWithCliError } from "../presentation/commandOutput.ts";
import { navigateToConversationIfNeeded } from "./askCommands.ts";

const conversationIdFromPage = (page: Page): string => {
  const conversationId = chatGptConversationIdFromUrl(page.url());
  if (conversationId === undefined || conversationId === null) return "current";
  return conversationId;
};

const assertDownloadProviderSupported = (options: DownloadCmdOptions): void => {
  if (providerIdFrom(options.provider) === "gemini") {
    exitWithCliError(
      "Attachment download is not supported for Gemini web yet. Use ChatGPT for /download.",
    );
  }
};

const downloadConversationAttachments = async (input: {
  page: Page;
  conversationId: string;
  repoRoot: string;
  options: DownloadCmdOptions;
  manifestRoot: string;
}): Promise<DownloadResult[]> => {
  const ids = parseAttachmentIds(input.options.id);
  return downloadAll(input.page, input.conversationId, {
    repoRoot: input.repoRoot,
    manifestRoot: input.manifestRoot,
    ...(input.options.out ? { outDir: input.options.out } : {}),
    ...(ids ? { ids } : {}),
  });
};

const writeDownloadOutput = (attachmentDownloads: DownloadResult[], json?: boolean): void => {
  if (json) {
    process.stdout.write(`${JSON.stringify(attachmentDownloads)}\n`);
    return;
  }
  for (const download of attachmentDownloads) {
    const line = `${formatDownloadLine(download)}
`;
    if (download.error) process.stderr.write(line);
    else process.stdout.write(line);
  }
};

export const parseAttachmentIds = (values: readonly string[] | undefined): string[] | undefined => {
  if (!values) return undefined;
  const ids = values
    .flatMap((value) => value.split(/[\s,]+/))
    .map((id) => id.trim())
    .filter(Boolean);
  return ids.length > 0 ? ids : undefined;
};

export const formatDownloadLine = (attachmentDownload: DownloadResult): string => {
  const label =
    attachmentDownload.id === undefined || attachmentDownload.id === ""
      ? "attachment"
      : attachmentDownload.id;
  if (attachmentDownload.error !== undefined) return `${label}: ${attachmentDownload.error}`;
  return `${label} -> ${attachmentDownload.path} (${attachmentDownload.bytes} bytes)`;
};

export const runDownload = async (options: DownloadCmdOptions): Promise<void> => {
  assertDownloadProviderSupported(options);
  const attachmentDownloads = await runDownloadFlow(options);
  writeDownloadOutput(attachmentDownloads, options.json);
  process.exit(0);
};

const runDownloadFlow = async (options: DownloadCmdOptions): Promise<DownloadResult[]> => {
  const context = await prepareDownloadContext(options);
  const attachmentDownloads = await downloadAfterExtract(context);
  await context.engine.shutdown({ closeBrowser: false });
  return attachmentDownloads;
};

const prepareDownloadContext = async (options: DownloadCmdOptions) => {
  const engine = await startDownloadEngine(options);
  const page = requireBrowserPage(engine);
  return {
    engine,
    page,
    conversationId:
      options.conversation === undefined ? conversationIdFromPage(page) : options.conversation,
    options,
  };
};

const downloadAfterExtract = async (input: {
  page: Page;
  conversationId: string;
  options: DownloadCmdOptions;
  engine: Awaited<ReturnType<typeof startDownloadEngine>>;
}): Promise<DownloadResult[]> => {
  const manifestRoot = attachmentManifestsDir();
  await navigateToConversationIfNeeded({
    engine: input.engine,
    conversation: input.options.conversation,
    page: input.page,
  });
  await extractAllMessages(input.page, { conversationId: input.conversationId, manifestRoot });
  if (input.options.scan) {
    const manifest = await loadManifest(input.conversationId, { manifestRoot });
    process.stderr.write(
      `Manifest refreshed: ${manifest.attachments.length} attachment(s) for ${input.conversationId}\n`,
    );
    return [];
  }
  return downloadConversationAttachments({
    ...input,
    repoRoot: input.engine.config.repoPath,
    manifestRoot,
  });
};

const startDownloadEngine = async (options: DownloadCmdOptions) => {
  return startEngine({
    repoPath: options.repo ? resolve(options.repo) : undefined,
    provider: providerIdFrom(options.provider),
    mcpPort: options.port ? Number(options.port) : undefined,
    withBrowser: true,
    withTools: false,
    persist: false,
    debugPort: debugPortFromOption(options.debugPort),
    profileRoot: profileRootFromOption(options.profile),
  });
};
