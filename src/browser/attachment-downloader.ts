import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";
import { loadManifest } from "./attachments.ts";
import type { Attachment } from "../types/types.ts";

interface DownloadOptions {
  outDir?: string;
}

interface DownloadAllOptions extends DownloadOptions {
  ids?: string[];
}

interface DownloadResult {
  path: string;
  bytes: number;
}

interface DownloadAllResult extends DownloadResult {
  id: string;
  error?: string;
}

/** Error raised when an attachment cannot be resolved or downloaded. */
export class AttachmentDownloadError extends Error {
  readonly id: string;
  readonly url: string | undefined;
  override readonly cause: unknown;

  constructor(id: string, url: string | undefined, message: string, cause?: unknown) {
    super(message);
    this.name = "AttachmentDownloadError";
    this.id = id;
    this.url = url;
    this.cause = cause;
  }
}

/** Download one attachment from a conversation manifest into the conversation downloads directory. */
export async function downloadAttachment(
  page: Page,
  conversationId: string,
  id: string,
  opts: DownloadOptions = {},
): Promise<DownloadResult> {
  const manifest = await loadManifest(conversationId);
  const attachment = manifest.attachments.find((item) => item.id === id);
  if (!attachment) {
    throw new AttachmentDownloadError(id, undefined, `Attachment not found in manifest: ${id}`);
  }

  const outDir = outputDirectory(conversationId, opts.outDir);
  await mkdir(outDir, { recursive: true });

  try {
    if (isHttpUrl(attachment.url)) {
      return await downloadHttpAttachment(page, attachment, outDir, manifest.attachments);
    }

    const filePath = await downloadPath(outDir, attachment, manifest.attachments);
    const bytes = attachment.url.startsWith("blob:")
      ? await fetchBlobBytes(page, attachment)
      : parseDataUrl(attachment);
    return await writeIfChanged(filePath, bytes);
  } catch (error) {
    if (error instanceof AttachmentDownloadError) throw error;
    throw new AttachmentDownloadError(
      attachment.id,
      attachment.url,
      `Failed to download attachment ${attachment.id}`,
      error,
    );
  }
}

/** Download all or selected attachments sequentially, preserving per-item failures in the result list. */
export async function downloadAll(
  page: Page,
  conversationId: string,
  opts: DownloadAllOptions = {},
): Promise<DownloadAllResult[]> {
  const manifest = await loadManifest(conversationId);
  const ids = opts.ids ?? manifest.attachments.map((attachment) => attachment.id);
  const results: DownloadAllResult[] = [];

  for (const attachmentId of ids) {
    try {
      const result = await downloadAttachment(page, conversationId, attachmentId, opts);
      results.push({ id: attachmentId, ...result });
    } catch (error) {
      results.push({
        id: attachmentId,
        path: "",
        bytes: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (results.length > 0 && results.every((result) => result.error)) {
    throw new AttachmentDownloadError(
      opts.ids?.join(",") ?? "*",
      undefined,
      `Failed to download all attachments for conversation ${conversationId}`,
      results,
    );
  }

  return results;
}

async function downloadHttpAttachment(
  page: Page,
  attachment: Attachment,
  outDir: string,
  attachments: Attachment[],
): Promise<DownloadResult> {
  const response = await page.context().request.get(attachment.url);
  if (!response.ok()) {
    throw new AttachmentDownloadError(
      attachment.id,
      attachment.url,
      `Attachment ${attachment.id} request failed with HTTP ${response.status()}`,
    );
  }

  const headers = response.headers();
  const filePath = await downloadPath(outDir, attachment, attachments, headers["content-type"]);
  const contentLength = Number(headers["content-length"]);
  if (Number.isSafeInteger(contentLength) && await existingSize(filePath) === contentLength) {
    return { path: filePath, bytes: contentLength };
  }

  const bytes = await response.body();
  return writeIfChanged(filePath, bytes);
}

async function fetchBlobBytes(page: Page, attachment: Attachment): Promise<Buffer> {
  try {
    const bytes = await page.evaluate(async (url: string): Promise<number[] | Uint8Array> => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Blob fetch failed with HTTP ${response.status}`);
      }
      return new Uint8Array(await response.arrayBuffer());
    }, attachment.url);
    return Buffer.from(bytes);
  } catch (error) {
    throw new AttachmentDownloadError(
      attachment.id,
      attachment.url,
      `Failed to fetch blob attachment ${attachment.id}`,
      error,
    );
  }
}

function parseDataUrl(attachment: Attachment): Buffer {
  const match = /^data:([^,]*),(.*)$/s.exec(attachment.url);
  if (!match) {
    throw new AttachmentDownloadError(attachment.id, attachment.url, `Invalid data URL for attachment ${attachment.id}`);
  }

  const metadata = match[1] ?? "";
  const payload = match[2] ?? "";
  if (metadata.split(";").includes("base64")) {
    return Buffer.from(payload, "base64");
  }
  return Buffer.from(decodeURIComponent(payload), "utf8");
}

async function writeIfChanged(filePath: string, bytes: Buffer): Promise<DownloadResult> {
  if (await existingSize(filePath) === bytes.byteLength) {
    return { path: filePath, bytes: bytes.byteLength };
  }
  await writeFile(filePath, bytes);
  return { path: filePath, bytes: bytes.byteLength };
}

async function downloadPath(
  outDir: string,
  attachment: Attachment,
  attachments: Attachment[],
  mimeOverride?: string,
): Promise<string> {
  const filename = filenameForAttachment(attachment, mimeOverride);
  const filePath = outputPath(outDir, filename);
  if (await existingSize(filePath) === undefined) return filePath;

  const owner = attachments.find((item) => filenameForAttachment(item, mimeOverride) === filename);
  if (!owner || isSameAttachment(owner, attachment)) return filePath;

  return outputPath(outDir, disambiguateFilename(filename, attachment.id));
}

async function existingSize(filePath: string): Promise<number | undefined> {
  try {
    return (await stat(filePath)).size;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
}

function outputDirectory(conversationId: string, outDir: string | undefined): string {
  if (outDir) return path.resolve(outDir);
  return path.resolve(process.cwd(), "downloads", conversationId);
}

function outputPath(outDir: string, filename: string): string {
  const resolvedOutDir = path.resolve(outDir);
  const filePath = path.resolve(resolvedOutDir, filename);
  const relativePath = path.relative(resolvedOutDir, filePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new AttachmentDownloadError("", undefined, `Invalid attachment output path: ${filename}`);
  }
  return filePath;
}

function filenameForAttachment(attachment: Attachment, mimeOverride?: string): string {
  const preferred = sanitizeFilename(attachment.filename);
  if (preferred) return withMissingExtension(preferred, attachment, mimeOverride);

  const derived = sanitizeFilename(filenameFromUrl(attachment.url));
  if (derived) return derived;

  return sanitizeFilename(`${attachment.id}${extensionForAttachment(attachment, mimeOverride)}`) ?? attachment.id;
}

function filenameFromUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const basename = path.posix.basename(parsed.pathname);
    return basename && basename !== "/" ? decodeURIComponent(basename) : undefined;
  } catch {
    return undefined;
  }
}

function sanitizeFilename(value: string | undefined): string | undefined {
  const sanitized = value
    ?.replace(/[\\/\0-\x1f\x7f]/g, "")
    .replace(/^\.+/, "")
    .trim();
  return sanitized ? sanitized : undefined;
}

function withMissingExtension(filename: string, attachment: Attachment, mimeOverride: string | undefined): string {
  if (path.extname(filename)) return filename;
  return `${filename}${extensionForAttachment(attachment, mimeOverride)}`;
}

function extensionForAttachment(attachment: Attachment, mimeOverride?: string): string {
  const mimeExtension = extensionForMime(mimeOverride) ?? extensionForMime(attachment.mime);
  if (mimeExtension) return mimeExtension;
  if (attachment.kind === "image") return ".png";
  if (attachment.kind === "pdf") return ".pdf";
  return "";
}

function extensionForMime(mime: string | undefined): string | undefined {
  const normalized = mime?.toLowerCase().split(";")[0]?.trim();
  if (normalized === "application/pdf") return ".pdf";
  if (normalized === "image/png") return ".png";
  if (normalized === "image/jpeg") return ".jpg";
  if (normalized === "image/webp") return ".webp";
  if (normalized === "image/gif") return ".gif";
  return undefined;
}

function isHttpUrl(url: string): boolean {
  return url.startsWith("https://") || url.startsWith("http://");
}

function disambiguateFilename(filename: string, id: string): string {
  const extension = path.extname(filename);
  if (!extension) return `${filename}-${id}`;
  return `${filename.slice(0, -extension.length)}-${id}${extension}`;
}

function isSameAttachment(left: Attachment, right: Attachment): boolean {
  return left.id === right.id
    && left.url === right.url
    && left.filename === right.filename;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
