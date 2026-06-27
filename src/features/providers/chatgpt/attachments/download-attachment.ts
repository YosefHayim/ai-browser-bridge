import { mkdir } from "node:fs/promises";
import type { Page } from "playwright";
import { loadManifest } from "./extract-messages.ts";
import {
  AttachmentDownloadError,
  type DownloadAllOptions,
  type DownloadAllResult,
  type DownloadOptions,
  type DownloadResult,
} from "./download-attachment.types.ts";
import { isHttpUrl, outputDirectory } from "./download-path.helpers.ts";
import { parseDataUrl } from "./download-filename.helpers.ts";
import { writeIfChanged } from "./download-write.helpers.ts";
import { downloadHttpAttachment, fetchBlobBytes, resolveDownloadPath } from "./download-http.helpers.ts";

/** Download one attachment from a conversation manifest. */
export async function downloadAttachment(
  page: Page,
  conversationId: string,
  id: string,
  opts: DownloadOptions = {},
): Promise<DownloadResult> {
  const manifest = await loadManifest(conversationId);
  const attachment = manifest.attachments.find((item) => item.id === id);
  if (!attachment) throw new AttachmentDownloadError(id, undefined, `Attachment not found in manifest: ${id}`);
  return downloadResolvedAttachment({ page, conversationId, attachment, attachments: manifest.attachments, opts });
}

/** Download all or selected attachments sequentially. */
export async function downloadAll(
  page: Page,
  conversationId: string,
  opts: DownloadAllOptions = {},
): Promise<DownloadAllResult[]> {
  const manifest = await loadManifest(conversationId);
  const ids = opts.ids ?? manifest.attachments.map((attachment) => attachment.id);
  const results = await downloadIds({ page, conversationId, ids, opts });
  if (results.length > 0 && results.every((result) => result.error)) {
    throw new AttachmentDownloadError(opts.ids?.join(",") ?? "*", undefined, `Failed to download all attachments for conversation ${conversationId}`, results);
  }
  return results;
}

export { AttachmentDownloadError } from "./download-attachment.types.ts";

interface DownloadResolvedInput {
  page: Page;
  conversationId: string;
  attachment: Awaited<ReturnType<typeof loadManifest>>["attachments"][number];
  attachments: Awaited<ReturnType<typeof loadManifest>>["attachments"];
  opts: DownloadOptions;
}

async function downloadResolvedAttachment(input: DownloadResolvedInput): Promise<DownloadResult> {
  const outDir = outputDirectory({ conversationId: input.conversationId, outDir: input.opts.outDir });
  await mkdir(outDir, { recursive: true });
  try {
    if (isHttpUrl(input.attachment.url)) {
      return await downloadHttpAttachment({ page: input.page, attachment: input.attachment, outDir, attachments: input.attachments });
    }
    const filePath = await resolveDownloadPath({ outDir, attachment: input.attachment, attachments: input.attachments });
    const bytes = input.attachment.url.startsWith("blob:")
      ? await fetchBlobBytes({ page: input.page, attachment: input.attachment })
      : parseDataUrl({ attachment: input.attachment });
    return await writeIfChanged({ filePath, bytes });
  } catch (error) {
    if (error instanceof AttachmentDownloadError) throw error;
    throw new AttachmentDownloadError(input.attachment.id, input.attachment.url, `Failed to download attachment ${input.attachment.id}`, error);
  }
}

interface DownloadIdsInput {
  page: Page;
  conversationId: string;
  ids: string[];
  opts: DownloadAllOptions;
}

async function downloadIds(input: DownloadIdsInput): Promise<DownloadAllResult[]> {
  const results: DownloadAllResult[] = [];
  for (const attachmentId of input.ids) results.push(await downloadOneId({ input, attachmentId }));
  return results;
}

async function downloadOneId(input: { input: DownloadIdsInput; attachmentId: string }): Promise<DownloadAllResult> {
  try {
    const result = await downloadAttachment(input.input.page, input.input.conversationId, input.attachmentId, input.input.opts);
    return { id: input.attachmentId, ...result };
  } catch (error) {
    return { id: input.attachmentId, path: "", bytes: 0, error: error instanceof Error ? error.message : String(error) };
  }
}
