import type { Page } from "playwright";
import { downloadAll } from "../../providers/chatgpt/attachments/download-attachment.ts";
import { normalizeProvider } from "../../providers/create-provider.factory.ts";
import type { DownloadCmdOptions, DownloadResult } from "./download.types.ts";
import { fail } from "./shared.ts";

/** Reject Gemini until attachment download is supported there. */
export function assertDownloadProviderSupported(options: DownloadCmdOptions): void {
  if (normalizeProvider(options.provider) === "gemini") {
    fail("Attachment download is not supported for Gemini web yet. Use ChatGPT for /download.");
  }
}

/** Download attachments with optional output dir and id filter. */
export async function downloadConversationAttachments(input: {
  page: Page;
  conversationId: string;
  options: DownloadCmdOptions;
}): Promise<DownloadResult[]> {
  const ids = parseAttachmentIds(input.options.id);
  return downloadAll(input.page, input.conversationId, {
    ...(input.options.out ? { outDir: input.options.out } : {}),
    ...(ids ? { ids } : {}),
  });
}

/** Write download results as JSON or human-readable lines. */
export function writeDownloadOutput(results: DownloadResult[], json?: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(results)}\n`);
    return;
  }
  for (const result of results) {
    const line = `${formatDownloadLine(result)}\n`;
    if (result.error) process.stderr.write(line);
    else process.stdout.write(line);
  }
}

/**
 * Flatten repeated `--id` flags into a clean id list.
 * Returns `undefined` when nothing remains so callers can omit `ids`.
 */
export function parseAttachmentIds(values: string[] | undefined): string[] | undefined {
  if (!values) return undefined;
  const ids = values.flatMap((value) => value.split(/[\s,]+/)).map((id) => id.trim()).filter(Boolean);
  return ids.length > 0 ? ids : undefined;
}

/** Render one download result as a human-readable line for the terminal. */
export function formatDownloadLine(result: DownloadResult): string {
  const label = result.id ?? "attachment";
  if (result.error) return `${label}: ${result.error}`;
  return `${label} -> ${result.path} (${result.bytes} bytes)`;
}
