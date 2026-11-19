import type { Page } from "playwright";
import type { ToolReport } from "@/message-types.ts";
import { readChatGptConversationIdFromUrl } from "@/providers/chatgpt/backend-api/chatgpt-conversation-url.ts";
import {
  downloadAll,
  downloadAttachment,
  loadManifest,
} from "@/providers/chatgpt/page/chatgpt-page.ts";
import { readErrorMessage } from "@/read-error-message.ts";
import { readDownloadsDirectory } from "@/repo-files/paths.ts";
import {
  DownloadAllAttachmentsArgumentListSchema,
  DownloadAttachmentArgumentListSchema,
  ListAttachmentsArgumentListSchema,
} from "@/repo-tools-mcp/tools-schemas.ts";
import type { ToolDef } from "@/tool-types.ts";

const NO_ACTIVE_CHATGPT_PAGE_MESSAGE = "No active ChatGPT browser page is available.";

function createDocumentToolReport(field: unknown): ToolReport {
  return { ok: true, output: JSON.stringify(field) };
}

function createFailureToolReport(error: unknown): ToolReport {
  return { ok: false, output: readErrorMessage(error), error: "tool-handler-error" };
}

function readOptionalString(field: unknown): string | null {
  const isTypeNotString = typeof field !== "string";
  if (isTypeNotString) return null;

  const isArgumentEmpty = field.length === 0;
  if (isArgumentEmpty) return null;

  return field;
}

function isPageLike(field: unknown): field is Page {
  const isNotObject = typeof field !== "object";
  if (isNotObject) return false;

  const isNull = field === null;
  if (isNull) return false;

  const pageUrl = (field as { url?: unknown }).url;
  return pageUrl instanceof Function;
}

function readPageFromArgumentList(argumentList: Record<string, unknown>): Page {
  const page = argumentList._page;

  const isPageMissing = !isPageLike(page);
  if (isPageMissing) throw new Error(NO_ACTIVE_CHATGPT_PAGE_MESSAGE);

  return page;
}

function readConversationIdFromArgumentList(argumentList: Record<string, unknown>): string {
  const givenConversationId = readOptionalString(argumentList.conversationId);

  const hasConversationId = givenConversationId != null;
  if (hasConversationId) return givenConversationId;

  const page = readPageFromArgumentList(argumentList);
  const pageConversationId = readChatGptConversationIdFromUrl(page.url());

  const isPageConversationIdMissing = pageConversationId == null;
  if (isPageConversationIdMissing) return "current";

  return pageConversationId;
}

function readAttachmentIdsFromArgumentList(argumentList: Record<string, unknown>): string[] | null {
  const ids = argumentList.ids;

  const isNotIdsArray = !Array.isArray(ids);
  if (isNotIdsArray) return null;

  return ids.filter((id): id is string => typeof id === "string");
}

async function listAttachments(argumentList: Record<string, unknown>): Promise<ToolReport> {
  try {
    const repoRoot = String(argumentList._repoRoot);
    const conversationId = readConversationIdFromArgumentList(argumentList);
    const downloadsDirectory = readDownloadsDirectory(repoRoot);
    const manifest = await loadManifest(conversationId, { manifestRoot: downloadsDirectory });

    return createDocumentToolReport(manifest.attachments);
  } catch (error) {
    return createFailureToolReport(error);
  }
}

async function downloadOneAttachment(argumentList: Record<string, unknown>): Promise<ToolReport> {
  try {
    const outDirectory = readOptionalString(argumentList.outDir);
    const repoRoot = String(argumentList._repoRoot);
    const isOutDirectoryMissing = outDirectory == null;
    const page = readPageFromArgumentList(argumentList);
    const conversationId = readConversationIdFromArgumentList(argumentList);
    const attachmentId = String(argumentList.id);
    const downloadsDirectory = readDownloadsDirectory(repoRoot);
    const downloaded = await downloadAttachment({
      page,
      conversationId,
      id: attachmentId,
      settings: {
        repoRoot,
        manifestRoot: downloadsDirectory,
        ...(isOutDirectoryMissing ? {} : { outDir: outDirectory }),
      },
    });

    return createDocumentToolReport(downloaded);
  } catch (error) {
    return createFailureToolReport(error);
  }
}

async function downloadAllAttachments(argumentList: Record<string, unknown>): Promise<ToolReport> {
  try {
    const outDirectory = readOptionalString(argumentList.outDir);
    const repoRoot = String(argumentList._repoRoot);
    const ids = readAttachmentIdsFromArgumentList(argumentList);
    const isOutDirectoryMissing = outDirectory == null;
    const isIdsMissing = ids == null;
    const page = readPageFromArgumentList(argumentList);
    const conversationId = readConversationIdFromArgumentList(argumentList);
    const downloadsDirectory = readDownloadsDirectory(repoRoot);
    const downloaded = await downloadAll(page, conversationId, {
      repoRoot,
      manifestRoot: downloadsDirectory,
      ...(isOutDirectoryMissing ? {} : { outDir: outDirectory }),
      ...(isIdsMissing ? {} : { ids }),
    });

    return createDocumentToolReport(downloaded);
  } catch (error) {
    return createFailureToolReport(error);
  }
}

export const listAttachmentsTool: ToolDef = {
  name: "chatgpt_list_attachments",
  description:
    "List captured attachments in a ChatGPT conversation, including their assistant/user role.",
  annotations: { title: "List ChatGPT attachments", readOnlyHint: true, openWorldHint: false },
  argsSchema: ListAttachmentsArgumentListSchema,
  handler: listAttachments,
};

export const downloadAttachmentTool: ToolDef = {
  name: "chatgpt_download_attachment",
  description: "Download one captured attachment from the active ChatGPT conversation.",
  annotations: {
    title: "Download ChatGPT attachment",
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  argsSchema: DownloadAttachmentArgumentListSchema,
  handler: downloadOneAttachment,
};

export const downloadAllAttachmentsTool: ToolDef = {
  name: "chatgpt_download_all",
  description:
    "Download all or selected captured attachments from the active ChatGPT conversation.",
  annotations: {
    title: "Download all ChatGPT attachments",
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  argsSchema: DownloadAllAttachmentsArgumentListSchema,
  handler: downloadAllAttachments,
};
