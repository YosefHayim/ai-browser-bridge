import type { Page } from "playwright";
import {
  DOWNLOADER_MODULE,
  isRecord,
  parseOutDir,
  printError,
  type AttachmentDownloaderModule,
  type DownloadResult,
} from "./files.helpers.ts";

interface HandleDownloadInput {
  page: Page;
  conversationId: string;
  parts: string[];
  manifestIds: string[];
}

/** Download one attachment or all attachments from `/files get`. */
export async function handleFilesDownload(input: HandleDownloadInput): Promise<void> {
  const outDir = parseOutDir(input.parts.slice(2));
  const downloader = await loadDownloader();
  if (input.parts[1] === "all") {
    return printBulkResults(await downloader.downloadAll(
      input.page,
      input.conversationId,
      outDir ? { outDir } : undefined,
    ));
  }
  await downloadOneAttachment({ input, downloader, outDir });
}

/** Download a single attachment by id. */
async function downloadOneAttachment(input: {
  input: HandleDownloadInput;
  downloader: AttachmentDownloaderModule;
  outDir: string | undefined;
}): Promise<void> {
  const id = input.input.parts[1]!;
  if (!input.input.manifestIds.includes(id)) return printError(`No attachment with id "${id}".`);
  const raw = await input.downloader.downloadAttachment(
    input.input.page,
    input.input.conversationId,
    id,
    input.outDir ? { outDir: input.outDir } : undefined,
  );
  console.log(normalizeDownloadResult({ value: raw, fallbackId: id }).path);
}

function printBulkResults(raw: unknown): void {
  const results = normalizeDownloadAll(raw);
  const succeeded = results.filter((result) => !result.error).length;
  const failed = results.length - succeeded;
  console.log(`Downloaded ${succeeded}/${results.length} attachments${failed > 0 ? ` (${failed} failed)` : ""}.`);
  for (const result of results) {
    if (result.error) printError(`${result.id ?? "unknown"}: ${result.error}`);
    else console.log(`${result.id ?? "attachment"} -> ${result.path} (${result.bytes} bytes)`);
  }
}

async function loadDownloader(): Promise<AttachmentDownloaderModule> {
  return await import(DOWNLOADER_MODULE) as AttachmentDownloaderModule;
}

function normalizeDownloadAll(value: unknown): DownloadResult[] {
  if (!Array.isArray(value)) return [];
  return value.map((...args: [unknown, number]) =>
    normalizeDownloadResult({ value: args[0], fallbackId: `attachment-${args[1] + 1}` }));
}

function normalizeDownloadResult(input: { value: unknown; fallbackId: string }): DownloadResult {
  if (!isRecord(input.value)) return { id: input.fallbackId, path: String(input.value), bytes: 0 };
  return {
    id: typeof input.value.id === "string" ? input.value.id : input.fallbackId,
    path: typeof input.value.path === "string" ? input.value.path : "",
    bytes: typeof input.value.bytes === "number" ? input.value.bytes : 0,
    error: typeof input.value.error === "string" ? input.value.error : undefined,
  };
}