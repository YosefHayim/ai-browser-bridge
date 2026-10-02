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
} from "./designRpc.ts";
import { assertDesignProjectIdle } from "./designTabs.ts";

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

const mimeTypeFor = (path: string): string => {
  const mimeType = MIME_TYPES[extname(path).toLowerCase()];
  if (mimeType === undefined) return "application/octet-stream";
  return mimeType;
};

const sizeFromWire = (size: string | undefined): number | undefined => {
  if (size === undefined) return undefined;
  const parsed = Number(size);
  if (!Number.isFinite(parsed)) return undefined;
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
    for (const entry of reply.entries) {
      let kind = "file";
      if (entry.type !== undefined) kind = entry.type;
      files.push({
        path: entry.path,
        kind,
        size: sizeFromWire(entry.size),
        contentType: entry.contentType,
        updatedAt: entry.updatedAt,
      });
    }
    if (reply.entries.length === 0 || files.length >= reply.total) return files;
  }
};

// Writing an existing path replaces it, the same as dropping a file in the app.
export const putDesignFiles = async (
  page: Page,
  input: { readonly projectId: string; readonly uploads: readonly DesignFileUpload[] },
): Promise<Array<{ readonly path: string; readonly version: string | undefined }>> => {
  await assertDesignProjectIdle(page, input.projectId);
  const files = await Promise.all(
    input.uploads.map(async (upload) => ({
      path: upload.path,
      data: (await readFile(upload.localPath)).toString("base64"),
      mimeType: mimeTypeFor(upload.path),
      encoding: "base64",
    })),
  );
  const reply = await callDesignRpc({
    page,
    method: "WriteFiles",
    body: { projectId: input.projectId, files, deduplicate: false },
    replySchema: WriteFilesReplySchema,
  });
  return reply.files.map((file) => ({ path: file.path, version: file.version }));
};

export const removeDesignFiles = async (
  page: Page,
  input: { readonly projectId: string; readonly paths: readonly string[] },
): Promise<Array<{ readonly path: string; readonly deleted: number }>> => {
  await assertDesignProjectIdle(page, input.projectId);
  const removed: Array<{ readonly path: string; readonly deleted: number }> = [];
  for (const path of input.paths) {
    const reply = await callDesignRpc({
      page,
      method: "DeleteFile",
      body: { projectId: input.projectId, path },
      replySchema: DeleteFileReplySchema,
    });
    removed.push({ path, deleted: reply.deleted });
  }
  return removed;
};

const fileInside = (outDir: string, projectPath: string): string => {
  const root = resolve(outDir);
  const target = resolve(root, projectPath);
  if (target.startsWith(`${root}/`)) return target;
  throw new Error(`Claude Design file path escapes the download folder: ${projectPath}`);
};

export const downloadDesignFiles = async (
  page: Page,
  input: { readonly projectId: string; readonly paths: readonly string[]; readonly outDir: string },
): Promise<string[]> => {
  const written: string[] = [];
  for (const path of input.paths) {
    const reply = await callDesignRpc({
      page,
      method: "GetFile",
      body: { projectId: input.projectId, path, raw: true },
      replySchema: GetFileReplySchema,
    });
    const target = fileInside(input.outDir, path);
    await mkdir(dirname(target), { recursive: true });
    let content = "";
    if (reply.content !== undefined) content = reply.content;
    await writeFile(target, Buffer.from(content, "base64"));
    written.push(target);
  }
  return written;
};

export const exportDesignProjectZip = async (
  page: Page,
  input: { readonly projectId: string; readonly outDir: string },
): Promise<string> => {
  const archive = await downloadDesignProjectZip(page, input.projectId);
  const target = join(resolve(input.outDir), `${basename(input.projectId)}.zip`);
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
  input: {
    readonly projectId: string;
    readonly format: DesignDownloadFormat;
    readonly paths: readonly string[] | undefined;
    readonly outDir: string;
  },
): Promise<string[]> => {
  if (input.format === "zip") {
    return [await exportDesignProjectZip(page, input)];
  }
  let paths = input.paths;
  if (paths === undefined || paths.length === 0) {
    const files = await listDesignFiles(page, input.projectId);
    paths = files.filter((file) => file.kind === "file").map((file) => file.path);
  }
  return downloadDesignFiles(page, { projectId: input.projectId, paths, outDir: input.outDir });
};
