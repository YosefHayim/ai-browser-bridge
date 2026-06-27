import type { APIResponse } from "playwright";
import type { Attachment } from "../../../domain/types.ts";
import { AttachmentDownloadError, type DownloadResult } from "./download-attachment.types.ts";
import { resolveDownloadPath } from "./download-http.helpers.ts";
import { existingSize, writeIfChanged } from "./download-write.helpers.ts";

/** Save an HTTP attachment response body when content changed. */
export async function saveHttpAttachmentResponse(input: {
  outDir: string;
  attachment: Attachment;
  attachments: Attachment[];
  response: APIResponse;
}): Promise<DownloadResult> {
  const headers = input.response.headers();
  const filePath = await resolveDownloadPath({
    outDir: input.outDir,
    attachment: input.attachment,
    attachments: input.attachments,
    mimeOverride: headers["content-type"],
  });
  const contentLength = Number(headers["content-length"]);
  if (Number.isSafeInteger(contentLength) && await existingSize({ filePath }) === contentLength) {
    return { path: filePath, bytes: contentLength };
  }
  return writeIfChanged({ filePath, bytes: await input.response.body() });
}

/** Throw when an HTTP attachment response is not successful. */
export function throwFailedHttpAttachment(input: {
  attachment: Attachment;
  status: number;
}): void {
  throw new AttachmentDownloadError(
    input.attachment.id,
    input.attachment.url,
    `Attachment ${input.attachment.id} request failed with HTTP ${input.status}`,
  );
}
