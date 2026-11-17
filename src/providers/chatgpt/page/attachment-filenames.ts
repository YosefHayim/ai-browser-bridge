import path from "node:path";
import type { Attachment } from "@/attachment-types.ts";
import {
  IMAGE_KIND,
  PDF_EXTENSION,
  PDF_KIND,
  PNG_EXTENSION,
  SLASH,
  UTF8_ENCODING,
} from "@/providers/chatgpt/page/chatgpt-page-constants.ts";
import { MIME_EXTENSIONS } from "@/providers/chatgpt/page/dom-snapshot-scripts.ts";

const BASE64_ENCODING = "base64";

const MIME_PARAMETER_SEPARATOR = ";";

type ParseEmbeddedUrlDetails = {
  attachment: Attachment;
};

export function parseEmbeddedUrl(details: ParseEmbeddedUrlDetails): Buffer {
  const hit = /^data:(?<metadata>[^,]*),(?<encodedPayload>.*)$/s.exec(details.attachment.url);

  const groups = hit?.groups;

  const isGroupsMissing = groups == null;
  if (isGroupsMissing) {
    throw new Error(`Invalid data URL for attachment ${details.attachment.id}`, {
      cause: { attachmentId: details.attachment.id, attachmentUrl: details.attachment.url },
    });
  }

  const metadata = groups.metadata ?? "";
  const encodedMessage = groups.encodedPayload ?? "";
  return decodeEmbeddedUrlBytes({ metadata, encodedPayload: encodedMessage });
}

function decodeEmbeddedUrlBytes(details: { metadata: string; encodedPayload: string }): Buffer {
  const isBase64Encoded = details.metadata
    .split(MIME_PARAMETER_SEPARATOR)
    .includes(BASE64_ENCODING);
  if (isBase64Encoded) {
    return Buffer.from(details.encodedPayload, BASE64_ENCODING);
  }

  const percentDecodedString = decodeURIComponent(details.encodedPayload);
  return Buffer.from(percentDecodedString, UTF8_ENCODING);
}

type SanitizeFilenameDetails = {
  value: string | null;
};

function sanitizeFilename(details: SanitizeFilenameDetails): string | null {
  const sanitized =
    details.value
      // biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally strips control characters from filename candidates
      ?.replace(/[\\/\0-\x1f\x7f]/g, "")
      .replace(/^\.+/, "")
      .trim() ?? "";

  const isSanitizedEmpty = sanitized === "";
  if (isSanitizedEmpty) return null;

  return sanitized;
}

type FilenameFromUrlDetails = {
  url: string;
};

function readFilenameFromUrl(details: FilenameFromUrlDetails): string | null {
  try {
    const parsed = new URL(details.url);
    const basename = path.posix.basename(parsed.pathname);

    const isBasenameMissing = basename === "" || basename === SLASH;
    if (isBasenameMissing) return null;

    return decodeURIComponent(basename);
  } catch (error) {
    const isUrlOrNameMalformed = error instanceof TypeError || error instanceof URIError;
    if (isUrlOrNameMalformed) return null;

    throw error;
  }
}

type SameAttachmentDetails = {
  left: Attachment;
  right: Attachment;
};

export function isSameAttachment(details: SameAttachmentDetails): boolean {
  return (
    details.left.id === details.right.id &&
    details.left.url === details.right.url &&
    details.left.filename === details.right.filename
  );
}

type ExtensionForMimeDetails = {
  mime: string | undefined;
};

function readMimeExtension(details: ExtensionForMimeDetails): string | null {
  const normalized = details.mime?.toLowerCase().split(MIME_PARAMETER_SEPARATOR)[0]?.trim();

  const isMimeMissing = normalized == null || normalized === "";
  if (isMimeMissing) return null;

  return MIME_EXTENSIONS[normalized] ?? null;
}

type ExtensionForAttachmentDetails = {
  attachment: Attachment;
  mimeOverride?: string;
};

function readAttachmentExtension(details: ExtensionForAttachmentDetails): string {
  const overrideExtension = readMimeExtension({ mime: details.mimeOverride });
  const attachmentExtension = readMimeExtension({ mime: details.attachment.mime });
  const mimeExtension = overrideExtension ?? attachmentExtension;

  const hasMimeExtension = mimeExtension != null;
  if (hasMimeExtension) return mimeExtension;

  const isImageKind = details.attachment.kind === IMAGE_KIND;
  if (isImageKind) return PNG_EXTENSION;

  const isPdfKind = details.attachment.kind === PDF_KIND;
  if (isPdfKind) return PDF_EXTENSION;

  return "";
}

type WithMissingExtensionDetails = {
  filename: string;
  attachment: Attachment;
  mimeOverride?: string;
};

function addExtensionIfMissing(details: WithMissingExtensionDetails): string {
  const hasFileExtension = path.extname(details.filename) !== "";
  if (hasFileExtension) return details.filename;

  const extension = readAttachmentExtension({
    attachment: details.attachment,
    mimeOverride: details.mimeOverride,
  });
  return `${details.filename}${extension}`;
}

type FilenameForAttachmentDetails = {
  attachment: Attachment;
  mimeOverride?: string;
};

export function readAttachmentFilename(details: FilenameForAttachmentDetails): string {
  const preferred = readPreferredFilename(details);

  const hasPreferred = preferred != null;
  if (hasPreferred) return preferred;

  const extension = readAttachmentExtension({
    attachment: details.attachment,
    mimeOverride: details.mimeOverride,
  });
  const fallback = sanitizeFilename({ value: `${details.attachment.id}${extension}` });

  const isFallbackMissing = fallback == null;
  if (isFallbackMissing) return details.attachment.id;

  return fallback;
}

function readPreferredFilename(details: FilenameForAttachmentDetails): string | null {
  const preferred = sanitizeFilename({ value: details.attachment.filename ?? null });

  const hasPreferred = preferred != null;
  if (hasPreferred) {
    return addExtensionIfMissing({
      filename: preferred,
      attachment: details.attachment,
      mimeOverride: details.mimeOverride,
    });
  }

  const filenameFromUrl = readFilenameFromUrl({ url: details.attachment.url });
  return sanitizeFilename({ value: filenameFromUrl });
}
