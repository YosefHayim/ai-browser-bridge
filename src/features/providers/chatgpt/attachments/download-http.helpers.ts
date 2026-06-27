import type { Page } from "playwright";
import type { Attachment } from "../../../domain/types.ts";
import { AttachmentDownloadError, type DownloadResult } from "./download-attachment.types.ts";
import {
  disambiguateFilename,
  outputPath,
} from "./download-path.helpers.ts";
import { existingSize } from "./download-write.helpers.ts";
import { filenameForAttachment, isSameAttachment } from "./download-filename.helpers.ts";
import { saveHttpAttachmentResponse, throwFailedHttpAttachment } from "./download-http.save.ts";

interface ResolveDownloadPathInput {
  outDir: string;
  attachment: Attachment;
  attachments: Attachment[];
  mimeOverride?: string;
}

/** Resolve a unique download path, disambiguating filename collisions. */
export async function resolveDownloadPath(input: ResolveDownloadPathInput): Promise<string> {
  const filename = filenameForAttachment({ attachment: input.attachment, mimeOverride: input.mimeOverride });
  const filePath = outputPath({ outDir: input.outDir, filename });
  if (await existingSize({ filePath }) === undefined) return filePath;
  return resolveCollidingDownloadPath({ input, filename, filePath });
}

async function resolveCollidingDownloadPath(input: {
  input: ResolveDownloadPathInput;
  filename: string;
  filePath: string;
}): Promise<string> {
  const owner = input.input.attachments.find((item) =>
    filenameForAttachment({ attachment: item, mimeOverride: input.input.mimeOverride }) === input.filename,
  );
  if (!owner || isSameAttachment({ left: owner, right: input.input.attachment })) return input.filePath;
  return outputPath({
    outDir: input.input.outDir,
    filename: disambiguateFilename({ filename: input.filename, id: input.input.attachment.id }),
  });
}

interface FetchBlobInput {
  page: Page;
  attachment: Attachment;
}

/** Fetch blob attachment bytes through the browser context. */
export async function fetchBlobBytes(input: FetchBlobInput): Promise<Buffer> {
  try {
    const bytes = await input.page.evaluate(async (url: string): Promise<number[] | Uint8Array> => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Blob fetch failed with HTTP ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    }, input.attachment.url);
    return Buffer.from(bytes);
  } catch (error) {
    throw new AttachmentDownloadError(
      input.attachment.id,
      input.attachment.url,
      `Failed to fetch blob attachment ${input.attachment.id}`,
      error,
    );
  }
}

interface DownloadHttpInput {
  page: Page;
  attachment: Attachment;
  outDir: string;
  attachments: Attachment[];
}

/** Download an https attachment through the browser request context. */
export async function downloadHttpAttachment(input: DownloadHttpInput): Promise<DownloadResult> {
  const response = await input.page.context().request.get(input.attachment.url);
  if (!response.ok()) throwFailedHttpAttachment({ attachment: input.attachment, status: response.status() });
  return await saveHttpAttachmentResponse({
    outDir: input.outDir,
    attachment: input.attachment,
    attachments: input.attachments,
    response,
  });
}
