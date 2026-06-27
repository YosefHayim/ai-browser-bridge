import path from "node:path";
import type { Attachment } from "../../../domain/types.ts";
import { filenameFromUrl, sanitizeFilename } from "./download-filename.core.ts";

const MIME_EXTENSIONS: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

interface ExtensionForMimeInput {
  /** MIME type used to infer a file extension. */
  mime: string | undefined;
}

/** Map a MIME type to a file extension when known. */
export function extensionForMime(input: ExtensionForMimeInput): string | undefined {
  const normalized = input.mime?.toLowerCase().split(";")[0]?.trim();
  return normalized ? MIME_EXTENSIONS[normalized] : undefined;
}

interface ExtensionForAttachmentInput {
  /** Attachment whose kind and mime infer the extension. */
  attachment: Attachment;
  /** Optional MIME override from response headers. */
  mimeOverride?: string;
}

/** Infer a file extension for an attachment. */
export function extensionForAttachment(input: ExtensionForAttachmentInput): string {
  const mimeExtension = extensionForMime({ mime: input.mimeOverride })
    ?? extensionForMime({ mime: input.attachment.mime });
  if (mimeExtension) return mimeExtension;
  if (input.attachment.kind === "image") return ".png";
  if (input.attachment.kind === "pdf") return ".pdf";
  return "";
}

interface WithMissingExtensionInput {
  filename: string;
  attachment: Attachment;
  mimeOverride?: string;
}

/** Append an inferred extension when the filename has none. */
export function withMissingExtension(input: WithMissingExtensionInput): string {
  if (path.extname(input.filename)) return input.filename;
  return `${input.filename}${extensionForAttachment({ attachment: input.attachment, mimeOverride: input.mimeOverride })}`;
}

interface FilenameForAttachmentInput {
  attachment: Attachment;
  mimeOverride?: string;
}

/** Resolve the on-disk filename for an attachment. */
export function filenameForAttachment(input: FilenameForAttachmentInput): string {
  const preferred = resolvePreferredFilename(input);
  if (preferred) return preferred;
  const fallback = sanitizeFilename({
    value: `${input.attachment.id}${extensionForAttachment({ attachment: input.attachment, mimeOverride: input.mimeOverride })}`,
  });
  return fallback ?? input.attachment.id;
}

function resolvePreferredFilename(input: FilenameForAttachmentInput): string | undefined {
  const preferred = sanitizeFilename({ value: input.attachment.filename });
  if (preferred) return withMissingExtension({ filename: preferred, attachment: input.attachment, mimeOverride: input.mimeOverride });
  return sanitizeFilename({ value: filenameFromUrl({ url: input.attachment.url }) });
}

export { parseDataUrl, sanitizeFilename, filenameFromUrl, isSameAttachment } from "./download-filename.core.ts";
