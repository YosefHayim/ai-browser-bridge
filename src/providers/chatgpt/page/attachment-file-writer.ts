import { stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { APIResponse, Page } from "playwright";
import { REPO_DIRECTORY_NAME } from "@/app-defaults.ts";
import type { Attachment } from "@/attachment-types.ts";
import { isNodeError } from "@/providers/chatgpt/page/attach-files.ts";
import type { DownloadReport } from "@/providers/chatgpt/page/attachment-downloader.ts";
import {
  isSameAttachment,
  readAttachmentFilename,
} from "@/providers/chatgpt/page/attachment-filenames.ts";
import { MISSING_FILE_ERROR_CODE } from "@/providers/chatgpt/page/chatgpt-page-constants.ts";

type DownloadPathDetails = {
  outDir: string;
  attachment: Attachment;
  attachments: Attachment[];
  mimeOverride?: string;
};

export async function readAvailableDownloadPath(details: DownloadPathDetails): Promise<string> {
  const filename = readAttachmentFilename({
    attachment: details.attachment,
    mimeOverride: details.mimeOverride,
  });

  const filePath = readSavePath({ outDir: details.outDir, filename });

  const isFileMissing = (await readExistingSize({ filePath })) == null;
  if (isFileMissing) return filePath;

  return readCollisionFreeDownloadPath({ input: details, filename, filePath });
}

async function readCollisionFreeDownloadPath(details: {
  input: DownloadPathDetails;
  filename: string;
  filePath: string;
}): Promise<string> {
  const owner = details.input.attachments.find(
    (element) =>
      readAttachmentFilename({ attachment: element, mimeOverride: details.input.mimeOverride }) ===
      details.filename,
  );

  const isOwnAttachment =
    !owner || isSameAttachment({ left: owner, right: details.input.attachment });
  if (isOwnAttachment) return details.filePath;

  const disambiguatedFilename = createDisambiguatedFilename({
    filename: details.filename,
    id: details.input.attachment.id,
  });
  return readSavePath({
    outDir: details.input.outDir,
    filename: disambiguatedFilename,
  });
}

type FetchBlobDetails = {
  page: Page;
  attachment: Attachment;
};

export async function fetchBlobBytes(details: FetchBlobDetails): Promise<Buffer> {
  try {
    const bytes = await details.page.evaluate(
      async (url: string): Promise<number[] | Uint8Array> => {
        const blobFetch = await fetch(url);

        const isBlobFetchFailed = !blobFetch.ok;
        if (isBlobFetchFailed) throw new Error(`Blob fetch failed with HTTP ${blobFetch.status}`);

        const blobArrayBuffer = await blobFetch.arrayBuffer();
        return new Uint8Array(blobArrayBuffer);
      },
      details.attachment.url,
    );
    return Buffer.from(bytes);
  } catch (error) {
    throw new Error(`Failed to fetch blob attachment ${details.attachment.id}`, {
      cause: {
        attachmentId: details.attachment.id,
        attachmentUrl: details.attachment.url,
        source: error,
      },
    });
  }
}

type DownloadHttpDetails = {
  page: Page;
  attachment: Attachment;
  url: string;
  outDir: string;
  attachments: Attachment[];
};

export async function downloadHttpAttachment(
  details: DownloadHttpDetails,
): Promise<DownloadReport> {
  const httpReply = await details.page.context().request.get(details.url);

  const isReplyFailed = !httpReply.ok();
  if (isReplyFailed) {
    const httpStatus = httpReply.status();
    throwFailedHttpAttachment({ attachment: details.attachment, status: httpStatus });
  }

  return await saveHttpAttachmentReply({
    outDir: details.outDir,
    attachment: details.attachment,
    attachments: details.attachments,
    httpResponse: httpReply,
  });
}

async function saveHttpAttachmentReply(details: {
  outDir: string;
  attachment: Attachment;
  attachments: Attachment[];
  httpResponse: APIResponse;
}): Promise<DownloadReport> {
  const headers = details.httpResponse.headers();
  const filePath = await readAvailableDownloadPath({
    outDir: details.outDir,
    attachment: details.attachment,
    attachments: details.attachments,
    mimeOverride: headers["content-type"],
  });

  const byteLength = Number(headers["content-length"]);

  const isDownloadAlreadyComplete =
    Number.isSafeInteger(byteLength) && (await readExistingSize({ filePath })) === byteLength;
  if (isDownloadAlreadyComplete) {
    return { path: filePath, bytes: byteLength };
  }

  const downloadedBytes = await details.httpResponse.body();
  return writeIfChanged({ filePath, bytes: downloadedBytes });
}

function throwFailedHttpAttachment(details: { attachment: Attachment; status: number }): void {
  throw new Error(
    `Attachment ${details.attachment.id} request failed with HTTP ${details.status}`,
    {
      cause: { attachmentId: details.attachment.id, attachmentUrl: details.attachment.url },
    },
  );
}

type SaveDirectoryDetails = {
  conversationId: string;
  outDir?: string;
  repoRoot: string;
};

export function readSaveDirectory(details: SaveDirectoryDetails): string {
  const { outDir } = details;
  const isOutDirFound = outDir != null && outDir !== "";
  if (isOutDirFound) return path.resolve(outDir);

  return path.resolve(details.repoRoot, REPO_DIRECTORY_NAME, "downloads", details.conversationId);
}

type SavePathDetails = {
  outDir: string;
  filename: string;
};

function readSavePath(details: SavePathDetails): string {
  const absoluteOutDir = path.resolve(details.outDir);
  const filePath = path.resolve(absoluteOutDir, details.filename);

  const relativePath = path.relative(absoluteOutDir, filePath);

  const isPathOutsideRoot = relativePath.startsWith("..") || path.isAbsolute(relativePath);
  if (isPathOutsideRoot) {
    throw new Error(`Invalid attachment output path: ${details.filename}`, {
      cause: { attachmentId: "", attachmentUrl: undefined },
    });
  }

  return filePath;
}

export function isHttpUrl(url: string): boolean {
  return url.startsWith("https://") || url.startsWith("http://");
}

type DisambiguateDetails = {
  filename: string;
  id: string;
};

function createDisambiguatedFilename(details: DisambiguateDetails): string {
  const extension = path.extname(details.filename);

  const isExtensionEmpty = !extension;
  if (isExtensionEmpty) return `${details.filename}-${details.id}`;

  return `${details.filename.slice(0, -extension.length)}-${details.id}${extension}`;
}

type ExistingSizeDetails = {
  filePath: string;
};

async function readExistingSize(details: ExistingSizeDetails): Promise<number | null> {
  try {
    return (await stat(details.filePath)).size;
  } catch (error) {
    const isMissingFileError = isNodeError(error) && error.code === MISSING_FILE_ERROR_CODE;
    if (isMissingFileError) return null;

    throw error;
  }
}

type WriteIfChangedDetails = {
  filePath: string;
  bytes: Buffer;
};

export async function writeIfChanged(details: WriteIfChangedDetails): Promise<DownloadReport> {
  const isFileSizeCurrent =
    (await readExistingSize({ filePath: details.filePath })) === details.bytes.byteLength;
  if (isFileSizeCurrent) {
    return { path: details.filePath, bytes: details.bytes.byteLength };
  }

  await writeFile(details.filePath, details.bytes);
  return { path: details.filePath, bytes: details.bytes.byteLength };
}
