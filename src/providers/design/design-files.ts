import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import type { Page } from "playwright";
import {
  callDesignRpc,
  DeleteFileReplySchema,
  downloadDesignProjectZip,
  GetFileReplySchema,
  ListFilesReplySchema,
  WriteFilesReplySchema,
} from "./design-rpc.ts";
import { assertDesignProjectIdle } from "./design-tabs.ts";

const ZIP_FORMAT = "zip";

const BASE64_ENCODING = "base64";

const FILE_KIND = "file";

const IMAGE_JPEG_MIME_TYPE = "image/jpeg";

const HTML_MIME_TYPE = "text/html";

export type DesignFile = {
  readonly path: string;
  readonly kind: string;
  readonly size: number | undefined;
  readonly contentType: string | undefined;
  readonly updatedAt: string | undefined;
};

export type DesignFileUpload = {
  readonly localPath: string;
  readonly path: string;
};

const LIST_DEPTH = 32;

const readMimeType = (path: string): string => {
  const mimeType = {
    ".css": "text/css",
    ".csv": "text/csv",
    ".gif": "image/gif",
    ".htm": HTML_MIME_TYPE,
    ".html": HTML_MIME_TYPE,
    ".jpeg": IMAGE_JPEG_MIME_TYPE,
    ".jpg": IMAGE_JPEG_MIME_TYPE,
    ".js": "text/javascript",
    ".json": "application/json",
    ".md": "text/markdown",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".txt": "text/plain",
    ".webp": "image/webp",
  }[extname(path).toLowerCase()];

  const isMimeTypeMissing = mimeType == null;
  if (isMimeTypeMissing) return "application/octet-stream";

  return mimeType;
};

const readSizeFromWire = (size: string | undefined): number | undefined => {
  const isSizeMissing = size == null;
  if (isSizeMissing) return undefined;

  const parsed = Number(size);

  const isNotParsedFinite = !Number.isFinite(parsed);
  if (isNotParsedFinite) return undefined;

  return parsed;
};

export const listDesignFiles = async (page: Page, projectId: string): Promise<DesignFile[]> => {
  const files: DesignFile[] = [];
  for (;;) {
    const reply = await callDesignRpc({
      page,
      method: "ListFiles",
      body: { projectId, depth: LIST_DEPTH, offset: files.length },
      replySchema: ListFilesReplySchema,
    });
    for (const file of reply.entries) {
      const kind = file.type ?? FILE_KIND;

      files.push({
        path: file.path,
        kind,
        size: readSizeFromWire(file.size),
        contentType: file.contentType,
        updatedAt: file.updatedAt,
      });
    }

    const isFileListEmpty = reply.entries.length === 0;
    if (isFileListEmpty) return files;

    const hasAllFilesListed = reply.total != null && files.length >= reply.total;
    if (hasAllFilesListed) return files;
  }
};

// Writing an existing path replaces it, the same as dropping a file in the app.
export const putDesignFiles = async (
  page: Page,
  request: { readonly projectId: string; readonly uploads: readonly DesignFileUpload[] },
): Promise<Array<{ readonly path: string; readonly version: string | undefined }>> => {
  await assertDesignProjectIdle(page, request.projectId);

  const uploadReads = request.uploads.map(async (upload) => ({
    path: upload.path,
    data: (await readFile(upload.localPath)).toString(BASE64_ENCODING),
    mimeType: readMimeType(upload.path),
    encoding: BASE64_ENCODING,
  }));
  const files = await Promise.all(uploadReads);
  const reply = await callDesignRpc({
    page,
    method: "WriteFiles",
    body: { projectId: request.projectId, files, deduplicate: false },
    replySchema: WriteFilesReplySchema,
  });

  return reply.files.map((file) => ({ path: file.path, version: file.version }));
};

export const removeDesignFiles = async (
  page: Page,
  request: { readonly projectId: string; readonly paths: readonly string[] },
): Promise<Array<{ readonly path: string; readonly deleted: number }>> => {
  await assertDesignProjectIdle(page, request.projectId);

  const removed: Array<{ readonly path: string; readonly deleted: number }> = [];

  for (const path of request.paths) {
    const reply = await callDesignRpc({
      page,
      method: "DeleteFile",
      body: { projectId: request.projectId, path },
      replySchema: DeleteFileReplySchema,
    });
    removed.push({ path, deleted: reply.deleted });
  }

  return removed;
};

const joinFileInside = (outDir: string, projectPath: string): string => {
  const root = resolve(outDir);

  const target = resolve(root, projectPath);

  const isInsideRoot = target.startsWith(`${root}/`);
  if (isInsideRoot) return target;

  throw new Error(`Claude Design file path escapes the download folder: ${projectPath}`);
};

const downloadDesignFiles = async (
  page: Page,
  request: {
    readonly projectId: string;
    readonly paths: readonly string[];
    readonly outDir: string;
  },
): Promise<string[]> => {
  const written: string[] = [];
  for (const path of request.paths) {
    const reply = await callDesignRpc({
      page,
      method: "GetFile",
      body: { projectId: request.projectId, path, raw: true },
      replySchema: GetFileReplySchema,
    });
    const target = joinFileInside(request.outDir, path);
    const targetFolder = dirname(target);
    await mkdir(targetFolder, { recursive: true });

    const fileBase64 = reply.content ?? "";

    const fileBytes = Buffer.from(fileBase64, BASE64_ENCODING);
    await writeFile(target, fileBytes);
    written.push(target);
  }
  return written;
};

const exportDesignProjectZip = async (
  page: Page,
  request: { readonly projectId: string; readonly outDir: string },
): Promise<string> => {
  const archive = await downloadDesignProjectZip(page, request.projectId);
  const destinationFolder = resolve(request.outDir);
  const target = join(destinationFolder, `${basename(request.projectId)}.zip`);
  const targetFolder = dirname(target);

  await mkdir(targetFolder, { recursive: true });
  await writeFile(target, archive);

  return target;
};

export const DESIGN_DOWNLOAD_FORMATS = ["files", ZIP_FORMAT] as const;
export type DesignDownloadFormat = (typeof DESIGN_DOWNLOAD_FORMATS)[number];

// The files command writes each project file under outDir; the zip command writes the archive.
export const downloadDesignProject = async (
  page: Page,
  request: {
    readonly projectId: string;
    readonly format: DesignDownloadFormat;
    readonly paths: readonly string[] | undefined;
    readonly outDir: string;
  },
): Promise<string[]> => {
  const isFormatZip = request.format === ZIP_FORMAT;
  if (isFormatZip) {
    return [await exportDesignProjectZip(page, request)];
  }

  const requestedPaths = request.paths;
  const hasRequestedPaths = requestedPaths != null && requestedPaths.length > 0;

  if (hasRequestedPaths) {
    return downloadDesignFiles(page, {
      projectId: request.projectId,
      paths: requestedPaths,
      outDir: request.outDir,
    });
  }

  const files = await listDesignFiles(page, request.projectId);
  const paths = files.filter((file) => file.kind === FILE_KIND).map((file) => file.path);
  return downloadDesignFiles(page, { projectId: request.projectId, paths, outDir: request.outDir });
};
