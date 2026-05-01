/**
 * End-to-end QA for ChatGPT assistant attachment extraction and download.
 *
 * Run with:
 *   pnpm tsx scripts/qa-attachment-flow.ts
 */
import { stat } from "node:fs/promises";
import path from "node:path";
import { BrowserManager } from "../src/browser/manager.ts";
import { SELECTORS, detectCurrentModel, injectPrompt, newConversation, selectModel, waitForResponse } from "../src/browser/chatgpt-page.ts";
import { extractAssistantContent } from "../src/browser/attachments.ts";
import { downloadAll } from "../src/browser/attachment-downloader.ts";
import type { Attachment } from "../src/types/types.ts";

const PROMPT = "Generate ONE single image (not multiple separate images) that contains 8 App Store screenshot mockups for an iOS PDF scanner app, arranged in a 2-column by 4-row grid. Each mockup should depict a different feature with cool 3D depth effects, glassmorphism, dramatic lighting and shadows: (1) document scanning with auto edge detection, (2) OCR text recognition, (3) PDF editing, (4) digital signature, (5) sharing/export, (6) folder organization, (7) batch processing, (8) cloud sync. Make it visually striking — like premium App Store hero artwork.";
const IMAGE_GENERATION_TIMEOUT_MS = 480_000;
const IN_FLIGHT_SETTLE_TIMEOUT_MS = 240_000;
const CONVERSATION_ID_TIMEOUT_MS = 30_000;
const IMAGE_MODEL_CANDIDATES = [
  { label: "GPT-4o", query: "GPT-4o gpt-4o" },
  { label: "GPT-5 Thinking", query: "GPT-5 Thinking gpt-5-thinking" },
  { label: "GPT-5", query: "GPT-5 gpt-5" },
] as const;

type ExtractedAssistantContent = Awaited<ReturnType<typeof extractAssistantContent>>;
type DownloadItem = Awaited<ReturnType<typeof downloadAll>>[number];

/** Run the live browser QA flow and return process-style status. */
async function main(): Promise<number> {
  const failures: string[] = [];
  const browser = new BrowserManager();
  try {
    console.log("[INFO] Launching ChatGPT browser session...");
    const page = await browser.launch();
    const streaming = await page.locator(SELECTORS.streamingIndicator).first().isVisible().catch(() => false);
    if (streaming) {
      console.log("[INFO] In-flight assistant stream detected; waiting for it to settle before starting a new conversation...");
      await waitForResponse(page, { timeout: IN_FLIGHT_SETTLE_TIMEOUT_MS });
    } else {
      console.log("[INFO] Starting a new conversation...");
      await newConversation(page);
    }
    const selectedModel = await selectImageCapableModel(page);
    console.log(`[INFO] Selected model: ${selectedModel}`);
    console.log("[INFO] Submitting image-generation prompt...");
    await injectPrompt(page, PROMPT);
    const conversationId = await waitForConversationId(() => page.url(), page.url());
    console.log(`[INFO] Conversation ID: ${conversationId}`);
    console.log("[INFO] Waiting for image attachment...");
    const extracted = await waitForImageAttachment(page, conversationId);
    printAssistantText(extracted.text);
    printAttachmentTable(extracted.attachments);

    if (!/\[image-\d+\]/.test(extracted.text)) {
      failures.push("assistant text did not contain an [image-N] placeholder");
    }
    if (!extracted.attachments.some((attachment) => attachment.kind === "image")) {
      failures.push("attachments array did not contain an image attachment");
    }

    console.log("[INFO] Downloading registered attachments...");
    const downloads = await downloadAll(page, conversationId);
    await assertDownloads(downloads, extracted.attachments, failures);
    printDownloadTable(downloads, extracted.attachments);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  } finally {
    await browser.close().catch((error: unknown) => {
      console.warn(`[WARN] Browser cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  if (failures.length > 0) {
    console.error(`[FAIL] Attachment QA failed: ${failures.join("; ")}`);
    return 1;
  }
  console.log("[PASS] Attachment QA succeeded.");
  return 0;
}

/** Resolve the current ChatGPT conversation id from a URL string. */
function conversationIdFromUrl(url: string): string | null {
  const match = /\/c\/([^/?#]+)/.exec(url);
  const id = match?.[1] ?? null;
  return id === "new" ? null : id;
}

/** Wait briefly for ChatGPT to move from the new-chat URL to a /c/<id> URL. */
async function waitForConversationId(currentUrl: () => string, initialUrl: string): Promise<string> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < CONVERSATION_ID_TIMEOUT_MS) {
    const id = conversationIdFromUrl(currentUrl());
    if (id) return id;
    await sleep(250);
  }
  const initialId = conversationIdFromUrl(initialUrl);
  if (initialId) return initialId;
  throw new Error("ChatGPT did not assign a conversation id within 30 seconds");
}

/** Prefer a model that can expose image generation, falling back to the current default. */
async function selectImageCapableModel(page: Parameters<typeof selectModel>[0]): Promise<string> {
  for (const model of IMAGE_MODEL_CANDIDATES) {
    try {
      return await selectModel(page, model.query);
    } catch {
      // Try the next acceptable image-capable model.
    }
  }

  const currentModel = await detectCurrentModel(page);
  const candidates = IMAGE_MODEL_CANDIDATES.map((model) => model.label).join(", ");
  console.warn(`[WARN] Could not select an image-capable model (${candidates}); proceeding with current model: ${currentModel}`);
  return currentModel;
}

/** Poll assistant extraction until an image attachment is visible and streaming has stopped. */
async function waitForImageAttachment(
  page: Parameters<typeof extractAssistantContent>[0],
  conversationId: string,
): Promise<ExtractedAssistantContent> {
  const startedAt = Date.now();
  const deadline = Date.now() + IMAGE_GENERATION_TIMEOUT_MS;
  let nextProgressLogAtMs = 30_000;
  let lastResult: ExtractedAssistantContent | null = null;

  while (Date.now() < deadline) {
    await page.waitForTimeout(5_000);
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= nextProgressLogAtMs) {
      console.log(`[INFO] Polling for image attachment (elapsed: ${Math.floor(elapsedMs / 1000)}s)`);
      nextProgressLogAtMs += 30_000;
    }
    try {
      lastResult = await extractAssistantContent(page, { conversationId });
    } catch {
      continue;
    }
    const hasImage = lastResult.attachments.some((attachment) => attachment.kind === "image");
    const streaming = await page.locator(SELECTORS.streamingIndicator).count() > 0;
    if (hasImage && !streaming) return lastResult;
  }
  if (!lastResult || !lastResult.attachments.some((attachment) => attachment.kind === "image")) {
    throw new Error("Image generation did not produce an image within 8 minutes");
  }
  return lastResult;
}

/** Check each download result has no error, exists on disk, and is non-trivially large. */
async function assertDownloads(
  downloads: DownloadItem[],
  attachments: Attachment[],
  failures: string[],
): Promise<void> {
  const attachmentIds = new Set(attachments.map((attachment) => attachment.id));
  if (downloads.length === 0) failures.push("downloadAll returned no results");

  for (const item of downloads) {
    if (!attachmentIds.has(item.id)) {
      failures.push(`download result referenced unknown attachment ${item.id}`);
    }
    if (item.error) {
      failures.push(`download ${item.id} failed: ${item.error}`);
      continue;
    }
    if (!item.path) {
      failures.push(`download ${item.id} did not report a path`);
      continue;
    }
    const bytesOnDisk = await fileSize(item.path);
    if (bytesOnDisk === null) {
      failures.push(`download ${item.id} path does not exist: ${item.path}`);
    } else if (bytesOnDisk <= 1024) {
      failures.push(`download ${item.id} is too small: ${bytesOnDisk} bytes`);
    }
  }
}

/** Return a file's byte size, or null when the path does not exist. */
async function fileSize(filePath: string): Promise<number | null> {
  try {
    return (await stat(filePath)).size;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

/** Print the extracted assistant text exactly as captured. */
function printAssistantText(text: string): void {
  console.log("\n=== Assistant Text ===");
  console.log(text);
}

/** Print the attachment manifest rows discovered from the assistant response. */
function printAttachmentTable(attachments: Attachment[]): void {
  console.log("\n=== Attachments ===");
  console.table(attachments.map((attachment) => ({
    id: attachment.id,
    kind: attachment.kind,
    filename: attachment.filename ?? "",
    mime: attachment.mime ?? "",
    messageIndex: attachment.messageIndex,
  })));
}

/** Print download result rows with filename and kind from the attachment manifest. */
function printDownloadTable(downloads: DownloadItem[], attachments: Attachment[]): void {
  const byId = new Map(attachments.map((attachment) => [attachment.id, attachment]));
  console.log("\n=== Downloads ===");
  console.table(downloads.map((item) => {
    const attachment = byId.get(item.id);
    return {
      id: item.id,
      filename: attachment?.filename ?? filenameFromPath(item.path),
      kind: attachment?.kind ?? "",
      bytes: item.bytes,
      path: item.path,
      status: item.error ? `FAIL: ${item.error}` : "PASS",
    };
  }));
}

/** Return the basename for display without throwing on an empty path. */
function filenameFromPath(filePath: string): string {
  return filePath ? path.basename(filePath) : "";
}

/** Sleep for the requested number of milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(`[FAIL] Attachment QA failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
