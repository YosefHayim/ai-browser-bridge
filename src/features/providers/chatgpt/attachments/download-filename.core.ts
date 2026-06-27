import path from "node:path";
import type { Attachment } from "../../../domain/types.ts";
import { AttachmentDownloadError } from "./download-attachment.types.ts";

interface ParseDataUrlInput {
  /** Attachment whose url is a data: URI. */
  attachment: Attachment;
}

/** Decode a data: URL attachment into bytes. */
export function parseDataUrl(input: ParseDataUrlInput): Buffer {
  const match = /^data:([^,]*),(.*)$/s.exec(input.attachment.url);
  if (!match) {
    throw new AttachmentDownloadError(
      input.attachment.id,
      input.attachment.url,
      `Invalid data URL for attachment ${input.attachment.id}`,
    );
  }
  return decodeDataUrlPayload({ metadata: match[1] ?? "", payload: match[2] ?? "" });
}

function decodeDataUrlPayload(input: { metadata: string; payload: string }): Buffer {
  if (input.metadata.split(";").includes("base64")) return Buffer.from(input.payload, "base64");
  return Buffer.from(decodeURIComponent(input.payload), "utf8");
}

interface SanitizeFilenameInput {
  /** Raw filename candidate. */
  value: string | undefined;
}

/** Remove unsafe characters from a filename candidate. */
export function sanitizeFilename(input: SanitizeFilenameInput): string | undefined {
  const sanitized = input.value
    ?.replace(/[\\/\0-\x1f\x7f]/g, "")
    .replace(/^\.+/, "")
    .trim();
  return sanitized ? sanitized : undefined;
}

interface FilenameFromUrlInput {
  /** URL whose pathname basename becomes the filename. */
  url: string;
}

/** Extract a filename from a URL pathname. */
export function filenameFromUrl(input: FilenameFromUrlInput): string | undefined {
  try {
    const parsed = new URL(input.url);
    const basename = path.posix.basename(parsed.pathname);
    return basename && basename !== "/" ? decodeURIComponent(basename) : undefined;
  } catch {
    return undefined;
  }
}

interface SameAttachmentInput {
  /** First attachment to compare. */
  left: Attachment;
  /** Second attachment to compare. */
  right: Attachment;
}

/** Whether two attachments refer to the same artifact. */
export function isSameAttachment(input: SameAttachmentInput): boolean {
  return input.left.id === input.right.id
    && input.left.url === input.right.url
    && input.left.filename === input.right.filename;
}
