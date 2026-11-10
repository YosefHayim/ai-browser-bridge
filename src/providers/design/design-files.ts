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

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css",
  ".csv": "text/csv",
  ".gif": "image/gif",
  ".htm": "text/html",
  ".html": "text/html",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript",
  ".json": "application/json",
  ".md": "text/markdown",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".webp": "image/webp",
};

const readMimeType = (path: string): string => {
  const mimeType = MIME_TYPES[extname(path).toLowerCase()];

  const isMimeTypeMissing = mimeType === undefined;
  if (isMimeTypeMissing) return "application/octet-stream";

  return mimeType;
};

const readSizeFromWire = (size: string | undefined): number | undefined => {
  const isSizeMissing = size === undefined;
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
      let kind = "file";

      const hasType = file.type !== undefined;
      if (hasType) kind = file.type;

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

    const hasAllFilesListed = reply.total !== undefined && files.length >= reply.total;
    if (hasAllFilesListed) return files;
  }
};

// Writing an existing path replaces it, the same as dropping a file in the app.
export const putDesignFiles = async (
  page: Page,
  request: { readonly projectId: string; readonly uploads: readonly DesignFileUpload[] },
): Promise<Array<{ readonly path: string; readonly version: string | undefined }>> => {
  await assertDesignProjectIdle(page, request.projectId);
  const files = await Promise.all(
    request.uploads.map(async (upload) => ({
      path: upload.path,
      data: (await readFile(upload.localPath)).toString("base64"),
      mimeType: readMimeType(upload.path),
      encoding: "base64",
    })),
  );
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
    await mkdir(dirname(target), { recursive: true });

    let fileBase64 = "";
    const hasReply = reply.content !== undefined;
    if (hasReply) fileBase64 = reply.content;

    await writeFile(target, Buffer.from(fileBase64, "base64"));
    written.push(target);
  }
  return written;
};

const exportDesignProjectZip = async (
  page: Page,
  request: { readonly projectId: string; readonly outDir: string },
): Promise<string> => {
  const archive = await downloadDesignProjectZip(page, request.projectId);
  const target = join(resolve(request.outDir), `${basename(request.projectId)}.zip`);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, archive);
  return target;
};

export const DESIGN_DOWNLOAD_FORMATS = ["files", "zip"] as const;
export type DesignDownloadFormat = (typeof DESIGN_DOWNLOAD_FORMATS)[number];

// `files` writes each project file under outDir (all files when no paths are given);
// `zip` writes the app's project archive.
export const downloadDesignProject = async (
  page: Page,
  request: {
    readonly projectId: string;
    readonly format: DesignDownloadFormat;
    readonly paths: readonly string[] | undefined;
    readonly outDir: string;
  },
): Promise<string[]> => {
  const isFormatZip = request.format === "zip";
  if (isFormatZip) {
    return [await exportDesignProjectZip(page, request)];
  }

  let paths = request.paths;
  if (paths === undefined || paths.length === 0) {
    const files = await listDesignFiles(page, request.projectId);
    paths = files.filter((file) => file.kind === "file").map((file) => file.path);
  }

  return downloadDesignFiles(page, { projectId: request.projectId, paths, outDir: request.outDir });
};
