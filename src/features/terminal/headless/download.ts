import { resolve } from "node:path";
import type { Page } from "playwright";
import { startEngine } from "../../bridge/create-engine.factory.ts";
import { extractAllMessages } from "../../providers/chatgpt/attachments/extract-messages.ts";
import { normalizeProvider } from "../../providers/create-provider.factory.ts";
import type { DownloadCmdOptions, DownloadResult } from "./download.types.ts";
import {
  assertDownloadProviderSupported,
  downloadConversationAttachments,
  writeDownloadOutput,
} from "./download.helpers.ts";
import { fail, redirectConsoleToStderr } from "./shared.ts";

export type { DownloadCmdOptions, DownloadResult } from "./download.types.ts";
export { parseAttachmentIds, formatDownloadLine } from "./download.helpers.ts";

/** Download a conversation's attachments to disk without the TUI. */
export async function runDownload(options: DownloadCmdOptions): Promise<void> {
  assertDownloadProviderSupported(options);
  redirectConsoleToStderr();
  const results = await runDownloadFlow(options);
  writeDownloadOutput(results, options.json);
  process.exit(0);
}

/** Start engine, extract messages, and download attachments. */
async function runDownloadFlow(options: DownloadCmdOptions): Promise<DownloadResult[]> {
  const context = await prepareDownloadContext(options);
  const results = await downloadAfterExtract(context);
  await context.engine.shutdown({ closeBrowser: false });
  return results;
}

/** Start engine and resolve page plus conversation id. */
async function prepareDownloadContext(options: DownloadCmdOptions) {
  const engine = await startDownloadEngine(options);
  const page = requireBrowserPage(engine);
  return {
    engine,
    page,
    conversationId: options.conversation ?? conversationIdFromPage(page),
    options,
  };
}

/** Download attachments with optional output dir and id filter. */
async function downloadAfterExtract(input: {
  page: Page;
  conversationId: string;
  options: DownloadCmdOptions;
}): Promise<DownloadResult[]> {
  await extractAllMessages(input.page, { conversationId: input.conversationId });
  return downloadConversationAttachments(input);
}

/** Start the engine for a headless download run. */
async function startDownloadEngine(options: DownloadCmdOptions) {
  return startEngine({
    repoPath: options.repo ? resolve(options.repo) : undefined,
    provider: normalizeProvider(options.provider),
    mcpPort: options.port ? Number(options.port) : undefined,
    withBrowser: true,
    withTools: false,
  });
}

/** Require a connected browser or exit with guidance. */
function requireBrowserPage(engine: Awaited<ReturnType<typeof startEngine>>): Page {
  if (!engine.browser) {
    void engine.shutdown({ closeBrowser: false });
    fail("Browser not connected. Run `bridge login` once to sign in to ChatGPT.");
  }
  return engine.browser!.getPage();
}

/** Resolve the conversation id from a ChatGPT `/c/<id>` URL, else "current". */
function conversationIdFromPage(page: Page): string {
  const match = /\/c\/([^/?#]+)/.exec(page.url());
  return match?.[1] ?? "current";
}
