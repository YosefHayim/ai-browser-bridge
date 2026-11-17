import { mkdir } from "node:fs/promises";
import type { Page } from "playwright";
import type { Attachment } from "@/attachment-types.ts";
import {
  isChatGptFileUrl,
  readChatGptFileDownloadUrl,
  readFileIdFromChatGptFileUrl,
} from "@/providers/chatgpt/backend-api/chatgpt-conversation-images.ts";
import {
  downloadHttpAttachment,
  fetchBlobBytes,
  isHttpUrl,
  readAvailableDownloadPath,
  readSaveDirectory,
  writeIfChanged,
} from "@/providers/chatgpt/page/attachment-file-writer.ts";
import { parseEmbeddedUrl } from "@/providers/chatgpt/page/attachment-filenames.ts";
import { loadManifest } from "@/providers/chatgpt/page/attachment-manifest.ts";
import { BLOB_URL_PREFIX } from "@/providers/chatgpt/page/chatgpt-page-constants.ts";
import { readErrorMessage } from "@/read-error-message.ts";

export interface DownloadAttachmentDetails {
  page: Page;
  conversationId: string;
  id: string;
  settings: DownloadSettings;
}

export async function downloadAttachment({
  page,
  conversationId,
  id,
  settings,
}: DownloadAttachmentDetails): Promise<DownloadReport> {
  const manifest = await loadManifest(conversationId, { manifestRoot: settings.manifestRoot });

  const attachment = manifest.attachments.find((attachment: Attachment) => attachment.id === id);

  const isAttachmentMissing = attachment == null;
  if (isAttachmentMissing)
    throw new Error(`Attachment not found in manifest: ${id}`, {
      cause: { attachmentId: id, attachmentUrl: undefined },
    });

  return downloadPreparedAttachment({
    page,
    conversationId,
    attachment,
    attachments: manifest.attachments,
    settings,
  });
}

export async function downloadAll(
  page: Page,
  conversationId: string,
  settings: DownloadAllSettings,
): Promise<DownloadAllReport[]> {
  const manifest = await loadManifest(conversationId, { manifestRoot: settings.manifestRoot });
  const manifestIds = manifest.attachments.map((attachment: Attachment) => attachment.id);
  const ids = settings.ids ?? manifestIds;

  const downloadReports = await downloadIds({ page, conversationId, ids, settings });

  const hasAllDownloadsFailed =
    downloadReports.length > 0 && downloadReports.every((downloadReport) => downloadReport.error);
  if (hasAllDownloadsFailed) {
    const failedIds = settings.ids?.join(",") ?? "*";
    throw new Error(`Failed to download all attachments for conversation ${conversationId}`, {
      cause: { attachmentId: failedIds, attachmentUrl: undefined, source: downloadReports },
    });
  }

  return downloadReports;
}

type DownloadPreparedDetails = {
  page: Page;
  conversationId: string;
  attachment: Attachment;
  attachments: Attachment[];
  settings: DownloadSettings;
};

async function downloadPreparedAttachment(
  details: DownloadPreparedDetails,
): Promise<DownloadReport> {
  const outDir = readSaveDirectory({
    conversationId: details.conversationId,
    outDir: details.settings.outDir,
    repoRoot: details.settings.repoRoot,
  });
  await mkdir(outDir, { recursive: true });
  try {
    if (isChatGptFileUrl(details.attachment.url)) {
      const attachmentFileId = readFileIdFromChatGptFileUrl(details.attachment.url);
      const downloadUrl = await readChatGptFileDownloadUrl({
        page: details.page,
        conversationId: details.conversationId,
        fileId: attachmentFileId,
      });
      return await downloadHttpAttachment({
        page: details.page,
        attachment: details.attachment,
        url: downloadUrl,
        outDir,
        attachments: details.attachments,
      });
    }

    if (isHttpUrl(details.attachment.url)) {
      return await downloadHttpAttachment({
        page: details.page,
        attachment: details.attachment,
        url: details.attachment.url,
        outDir,
        attachments: details.attachments,
      });
    }

    const filePath = await readAvailableDownloadPath({
      outDir,
      attachment: details.attachment,
      attachments: details.attachments,
    });
    const isAttachmentUrlStartsWithBlob = details.attachment.url.startsWith(BLOB_URL_PREFIX);
    const bytes = isAttachmentUrlStartsWithBlob
      ? await fetchBlobBytes({ page: details.page, attachment: details.attachment })
      : parseEmbeddedUrl({ attachment: details.attachment });
    return await writeIfChanged({ filePath, bytes });
  } catch (error) {
    if (isAttachmentFailure(error)) throw error;

    throw new Error(`Failed to download attachment ${details.attachment.id}`, {
      cause: {
        attachmentId: details.attachment.id,
        attachmentUrl: details.attachment.url,
        source: error,
      },
    });
  }
}

type DownloadIdsDetails = {
  page: Page;
  conversationId: string;
  ids: string[];
  settings: DownloadAllSettings;
};

async function downloadIds(details: DownloadIdsDetails): Promise<DownloadAllReport[]> {
  const downloadReports: DownloadAllReport[] = [];

  for (const attachmentId of details.ids) {
    const downloadReport = await downloadOneId({ input: details, attachmentId });
    downloadReports.push(downloadReport);
  }

  return downloadReports;
}

async function downloadOneId(details: {
  input: DownloadIdsDetails;
  attachmentId: string;
}): Promise<DownloadAllReport> {
  try {
    const downloaded = await downloadAttachment({
      page: details.input.page,
      conversationId: details.input.conversationId,
      id: details.attachmentId,
      settings: details.input.settings,
    });
    return { id: details.attachmentId, ...downloaded };
  } catch (error) {
    return {
      id: details.attachmentId,
      path: "",
      bytes: 0,
      error: readErrorMessage(error),
    };
  }
}

// Attachment failures are plain Errors whose cause holds the attachment id, url and source error.
function isAttachmentFailure(error: unknown): boolean {
  const isErrorObject = error instanceof Error;
  if (!isErrorObject) return false;

  const failureCause = error.cause;
  const isCauseObject = typeof failureCause === "object" && failureCause !== null;
  return isCauseObject && "attachmentId" in failureCause;
}

export type DownloadReport = {
  path: string;
  bytes: number;
};

type DownloadAllReport = DownloadReport & {
  id: string;
  error?: string;
};

type DownloadSettings = {
  outDir?: string;
  repoRoot: string;
  manifestRoot?: string | undefined;
};

type DownloadAllSettings = DownloadSettings & {
  ids?: string[];
};
