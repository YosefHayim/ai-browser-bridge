import type { Page } from "playwright";
import { DOWNLOADER_MODULE } from "./attachment.normalize.ts";

/** Lazy-loaded attachment downloader module. */
export interface AttachmentDownloaderModule {
  downloadAttachment(page: Page, conversationId: string, id: string, opts?: { outDir?: string }): Promise<unknown>;
  downloadAll(page: Page, conversationId: string, opts?: { outDir?: string; ids?: string[] }): Promise<unknown>;
}

/** Coerce an unknown page handle into a Playwright page when possible. */
export function optionalPage(value: unknown): Page | null {
  if (typeof value !== "object" || value === null || typeof (value as Page).url !== "function") return null;
  return value as Page;
}

/** Resolve the active or explicit conversation id from tool args. */
export function resolveConversationId(args: Record<string, unknown>): string {
  const explicit = explicitConversationId(args);
  if (explicit) return explicit;
  return conversationIdFromPage(args);
}

function explicitConversationId(args: Record<string, unknown>): string | undefined {
  return typeof args.conversationId === "string" && args.conversationId.length > 0
    ? args.conversationId
    : undefined;
}

function conversationIdFromPage(args: Record<string, unknown>): string {
  const page = optionalPage(args._page);
  if (!page) throw new Error("No active ChatGPT browser page is available.");
  const match = /\/c\/([^/?#]+)/.exec(page.url());
  return match?.[1] ?? "current";
}

/** Resolve the active Playwright page from tool args. */
export function resolvePage(args: Record<string, unknown>): Page {
  const page = optionalPage(args._page);
  if (!page) throw new Error("No active ChatGPT browser page is available.");
  return page;
}

/** Lazy-load the attachment downloader module. */
export async function loadDownloader(): Promise<AttachmentDownloaderModule> {
  return await import(DOWNLOADER_MODULE) as AttachmentDownloaderModule;
}
