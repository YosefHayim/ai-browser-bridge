/**
 * QA extractor and downloader against an existing populated ChatGPT conversation.
 *
 * Run with:
 *   pnpm tsx scripts/qa-extract-and-download.ts [conversationId]
 */
import path from "node:path";
import type { Page } from "playwright";
import { BrowserManager } from "../src/browser/manager.ts";
import { AttachmentDownloadError, downloadAll } from "../src/browser/attachment-downloader.ts";
import { extractAllMessages, loadManifest } from "../src/browser/attachments.ts";
import type { Attachment } from "../src/types/types.ts";

const DEFAULT_CONVERSATION_ID = "69f21d66-3d9c-8392-8f25-b331d1a922a2";
const MESSAGE_RENDER_WAIT_MS = 5_000;
const SCROLL_STEP_PX = 200;
const SCROLL_PAUSE_MS = 200;
const SCROLL_MAX_STEPS = 500;

/** Scrollable container identifier shared with hydration helpers. */
interface ScrollTargetInfo {
  selector: string;
}

type ExtractedMessage = Awaited<ReturnType<typeof extractAllMessages>>[number];
type DownloadItem = Awaited<ReturnType<typeof downloadAll>>[number];
type AttachmentKind = Attachment["kind"];
type AttachmentKindTotals = Record<AttachmentKind, number>;

/** Run extraction and download QA against the requested conversation. */
async function main(): Promise<number> {
  const conversationId = process.argv[2] ?? DEFAULT_CONVERSATION_ID;
  const browser = new BrowserManager();

  try {
    console.log(`[INFO] Connecting to browser for conversation ${conversationId}...`);
    const page = await browser.launch();
    const url = `https://chatgpt.com/c/${conversationId}`;

    console.log(`[INFO] Navigating to ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(MESSAGE_RENDER_WAIT_MS);

    // tsx/esbuild instruments named function declarations with a __name helper that
    // doesn't exist in the browser. Inject a noop before any other page.evaluate
    // call so transpiled bodies don't throw ReferenceError.
    await page.evaluate(() => {
      if (typeof (globalThis as { __name?: unknown }).__name === "undefined") {
        (globalThis as unknown as { __name: (fn: unknown) => unknown }).__name = (fn) => fn;
      }
    });

    console.log("[INFO] Hydrating lazy-rendered messages via scroll passes...");
    await hydrateMessageThread(page);

    console.log("[INFO] Extracting all rendered messages...");
    const messages = await extractAllMessages(page, { conversationId, includeUserAttachments: true });
    printMessageSummaries(messages);

    const totals = attachmentKindTotals(messages);
    printAttachmentKindTotals(totals);

    const attachmentCount = Object.values(totals).reduce((sum, count) => sum + count, 0);
    const userImageAttachments = extractedAttachments(messages)
      .filter((attachment) => attachment.role === "user" && attachment.kind === "image");
    if (attachmentCount === 0) {
      console.error("[FAIL] extractor found no attachments in conversation that visually contains images");
      console.error("[HINT] Check whether ChatGPT lazy-renders historical images and the script needs to scroll.");
      return 1;
    }
    if (userImageAttachments.length < 2) {
      console.error(`[FAIL] extractor found ${userImageAttachments.length} user image attachments; expected at least 2`);
      return 1;
    }

    console.log("[INFO] Downloading all manifest attachments...");
    const downloads = await downloadAllWithFailedResults(page, conversationId);
    const manifest = await loadManifest(conversationId);
    printDownloadResults(downloads, manifest.attachments);

    const userImageIds = new Set(userImageAttachments.map((attachment) => attachment.id));
    const userImageDownloads = downloads.filter((item) => userImageIds.has(item.id));
    const undersized = userImageDownloads.filter((item) => item.error || item.bytes <= 1024);
    if (userImageDownloads.length < userImageAttachments.length || undersized.length > 0) {
      console.error("[FAIL] one or more user image attachments did not download above 1024 bytes");
      return 1;
    }
    return 0;
  } catch (error) {
    console.error(`[FAIL] ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  } finally {
    await browser.close().catch((error: unknown) => {
      console.warn(`[WARN] Browser cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
}

/**
 * Force ChatGPT's virtualized thread to mount every message and its lazy
 * <img> attachments by scrolling the message container top→bottom→top→bottom
 * in small steps. ChatGPT only attaches user-uploaded images to the DOM after
 * their parent block scrolls into view, so without this pass the extractor
 * sees zero attachments on long conversations.
 */
async function hydrateMessageThread(page: Page): Promise<void> {
  const target = await findScrollTarget(page);
  await scrollContainer(page, target, "down");
  await scrollContainer(page, target, "up");
  await scrollContainer(page, target, "down");
}

/** Locate the scrollable thread container that wraps the message blocks. */
async function findScrollTarget(page: Page): Promise<ScrollTargetInfo> {
  const selector = await page.evaluate((): string => {
    const candidates = [
      "main [role='presentation']",
      "div[class*='thread']",
      "div[class*='Thread']",
      "div[class*='conversation']",
      "div[class*='Conversation']",
      "main",
      "[role='main']",
    ];
    const blocks = Array.from(
      document.querySelectorAll<HTMLElement>('[data-message-author-role="assistant"], [data-message-author-role="user"]'),
    );
    for (const sel of candidates) {
      const el = document.querySelector<HTMLElement>(sel);
      if (!el) continue;
      if (blocks.length > 0 && !blocks.some((block) => el.contains(block))) continue;
      if (el.scrollHeight <= el.clientHeight + 20) continue;
      return sel;
    }
    return "document.scrollingElement";
  });
  return { selector };
}

/** Scroll the resolved container in one direction until it can't move further. */
async function scrollContainer(
  page: Page,
  target: ScrollTargetInfo,
  direction: "up" | "down",
): Promise<void> {
  for (let step = 0; step < SCROLL_MAX_STEPS; step += 1) {
    const stuck = await page.evaluate(
      (args: { selector: string; step: number; direction: "up" | "down" }): boolean => {
        const el = args.selector === "document.scrollingElement"
          ? (document.scrollingElement as HTMLElement | null)
          : document.querySelector<HTMLElement>(args.selector);
        if (!el) return true;
        const before = el.scrollTop;
        const next = args.direction === "down"
          ? Math.min(before + args.step, el.scrollHeight)
          : Math.max(before - args.step, 0);
        el.scrollTo({ top: next, behavior: "instant" });
        return el.scrollTop === before;
      },
      { selector: target.selector, step: SCROLL_STEP_PX, direction },
    );
    if (stuck) break;
    await page.waitForTimeout(SCROLL_PAUSE_MS);
  }
}

/** Download all attachments, preserving downloader rows when every item fails. */
async function downloadAllWithFailedResults(
  page: Parameters<typeof downloadAll>[0],
  conversationId: string,
): Promise<DownloadItem[]> {
  try {
    return await downloadAll(page, conversationId);
  } catch (error) {
    if (error instanceof AttachmentDownloadError && isDownloadItems(error.cause)) {
      return error.cause;
    }
    throw error;
  }
}

/** Print one summary row per extracted message. */
function printMessageSummaries(messages: ExtractedMessage[]): void {
  console.log("\n=== Messages ===");
  for (const [index, message] of messages.entries()) {
    const attachments = message.attachments
      .map((attachment) => `${attachment.id}:${attachment.role}:${attachment.kind}`)
      .join(", ");
    console.log([
      `index=${index}`,
      `role=${message.role}`,
      `textLength=${message.content.length}`,
      `attachmentCount=${message.attachments.length}`,
      `attachments=${attachments}`,
    ].join(" | "));
  }
}

/** Count extracted attachments by kind. */
function attachmentKindTotals(messages: ExtractedMessage[]): AttachmentKindTotals {
  const totals: AttachmentKindTotals = { image: 0, file: 0, pdf: 0 };
  for (const attachment of extractedAttachments(messages)) {
    totals[attachment.kind] += 1;
  }
  return totals;
}

/** Flatten extracted message attachments. */
function extractedAttachments(messages: ExtractedMessage[]): Attachment[] {
  return messages.flatMap((message) => message.attachments);
}

/** Print total extracted attachments by kind. */
function printAttachmentKindTotals(totals: AttachmentKindTotals): void {
  console.log("\n=== Attachment Totals By Kind ===");
  for (const kind of attachmentKinds()) {
    console.log(`${kind}=${totals[kind]}`);
  }
}

/** Print download rows and aggregate totals. */
function printDownloadResults(downloads: DownloadItem[], attachments: Attachment[]): void {
  const byId = new Map(attachments.map((attachment) => [attachment.id, attachment]));
  let succeeded = 0;
  let failed = 0;
  let totalBytes = 0;

  console.log("\n=== Downloads ===");
  console.log("id|role|kind|filename|bytes|path|error");
  for (const item of downloads) {
    const attachment = byId.get(item.id);
    if (item.error) failed += 1;
    else succeeded += 1;
    totalBytes += item.bytes;

    console.log([
      item.id,
      attachment?.role ?? "",
      attachment?.kind ?? "",
      attachment?.filename ?? filenameFromPath(item.path),
      String(item.bytes),
      item.path,
      item.error ?? "",
    ].join("|"));
  }

  console.log("\n=== Download Totals ===");
  console.log(`succeeded=${succeeded}`);
  console.log(`failed=${failed}`);
  console.log(`totalBytes=${totalBytes}`);
}

/** Return supported attachment kinds in stable display order. */
function attachmentKinds(): AttachmentKind[] {
  return ["image", "file", "pdf"];
}

/** Return the basename for display without throwing on an empty path. */
function filenameFromPath(filePath: string): string {
  return filePath ? path.basename(filePath) : "";
}

/** Check whether an unknown downloader error cause contains download result rows. */
function isDownloadItems(value: unknown): value is DownloadItem[] {
  return Array.isArray(value) && value.every(isDownloadItem);
}

/** Check whether an unknown value has the minimal download result shape. */
function isDownloadItem(value: unknown): value is DownloadItem {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<DownloadItem>;
  return typeof candidate.id === "string"
    && typeof candidate.path === "string"
    && typeof candidate.bytes === "number"
    && (candidate.error === undefined || typeof candidate.error === "string");
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(`[FAIL] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
