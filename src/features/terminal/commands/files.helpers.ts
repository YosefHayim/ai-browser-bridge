import type { Page } from "playwright";
import type { Attachment, CommandContext } from "../../domain/types.ts";

/** Runtime orchestrator extension exposing the active Playwright page. */
export interface RuntimeOrchestrator {
  page?: Page | null;
}

/** Normalized attachment download result. */
export interface DownloadResult {
  id?: string;
  path: string;
  bytes: number;
  error?: string;
}

/** Lazy-loaded attachment downloader module. */
export interface AttachmentDownloaderModule {
  downloadAttachment(page: Page, conversationId: string, id: string, opts?: { outDir?: string }): Promise<unknown>;
  downloadAll(page: Page, conversationId: string, opts?: { outDir?: string; ids?: string[] }): Promise<unknown>;
}

/** Path to the lazy-loaded downloader module. */
export const DOWNLOADER_MODULE = "../../providers/chatgpt/attachments/download-attachment.ts";
export const RED = "\u001b[31m";
export const RESET = "\u001b[0m";

/** Return the active Playwright page from command context. */
export function currentPage(ctx: CommandContext): Page | null {
  const orchestrator = ctx.orchestrator as CommandContext["orchestrator"] & RuntimeOrchestrator;
  return orchestrator.page ?? null;
}

/** Extract the ChatGPT conversation id from the active page URL. */
export function conversationIdFromPage(page: Page): string {
  const match = /\/c\/([^/?#]+)/.exec(page.url());
  return match?.[1] ?? "current";
}

/** Whether a value is a non-null object record. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Parse `--out <dir>` from slash-command args. */
export function parseOutDir(args: string[]): string | undefined {
  const outIndex = args.indexOf("--out");
  if (outIndex === -1) return undefined;
  return args[outIndex + 1];
}

/** Print an error message to stderr in red. */
export function printError(message: string): void {
  console.error(`${RED}${message}${RESET}`);
}
