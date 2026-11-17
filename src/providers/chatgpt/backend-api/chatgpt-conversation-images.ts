import type { Page } from "playwright";
import type { Attachment, AttachmentRole } from "@/attachment-types.ts";
import { readChatGptApi } from "@/providers/chatgpt/backend-api/api-requests.ts";

const IMAGE_ID_STEM = "image";

const USER_ROLE = "user";

const CHATGPT_FILE_URL_PREFIX = "chatgpt-file:";
const FILE_NUMBER_WIDTH = 2;

export interface ConversationImageRef {
  fileId: string;
  role: AttachmentRole;
  createTime: number;
}

interface ConversationMessage {
  author?: { role?: string };
  create_time?: number | null;
  content?: { parts?: unknown[] };
}

interface ConversationNode {
  message?: ConversationMessage | null;
}

export interface ConversationReply {
  mapping: Record<string, ConversationNode>;
}

interface ImagePointerPart {
  content_type: "image_asset_pointer";
  asset_pointer: string;
}

interface ChatGptFileDownloadReply {
  download_url?: string;
}

function createChatGptFileUrl(fileId: string): string {
  return `${CHATGPT_FILE_URL_PREFIX}${fileId}`;
}

export function isChatGptFileUrl(url: string): boolean {
  return url.startsWith(CHATGPT_FILE_URL_PREFIX);
}

export function readFileIdFromChatGptFileUrl(url: string): string {
  return url.slice(CHATGPT_FILE_URL_PREFIX.length);
}

function isMessage(
  message: ConversationMessage | null | undefined,
): message is ConversationMessage {
  return message != null;
}

function isImagePointerPart(part: unknown): part is ImagePointerPart {
  const isPartNotObjectLike = typeof part !== "object" || part === null;
  if (isPartNotObjectLike) return false;

  return "content_type" in part && part.content_type === "image_asset_pointer";
}

function readFileIdFromAssetPointer(assetPointer: string): string {
  const pointerHit = /^(?:file-service|sediment):\/\/(?<fileId>.+)$/.exec(assetPointer);
  const fileId = pointerHit?.groups?.fileId;

  const isFileIdMissing = fileId == null;
  if (isFileIdMissing) throw new Error("ChatGPT image pointer has an unknown scheme.");

  return fileId;
}

function listImageRefsInMessage(message: ConversationMessage): ConversationImageRef[] {
  const parts = message.content?.parts ?? [];
  const isUserRole = message.author?.role === USER_ROLE;
  const role: AttachmentRole = isUserRole ? USER_ROLE : "assistant";
  const createTime = message.create_time ?? 0;

  return parts.filter(isImagePointerPart).map((part) => ({
    fileId: readFileIdFromAssetPointer(part.asset_pointer),
    role,
    createTime,
  }));
}

export function listConversationImageRefs(conversation: ConversationReply): ConversationImageRef[] {
  const messages = Object.values(conversation.mapping)
    .map((node) => node.message)
    .filter(isMessage);
  const imageRefs = messages.flatMap(listImageRefsInMessage);
  return imageRefs.sort((first, second) => first.createTime - second.createTime);
}

export function listAttachmentsFromImageRefs(details: {
  refs: ConversationImageRef[];
  createdAt: string;
}): Attachment[] {
  const counters: Record<AttachmentRole, number> = { assistant: 0, user: 0 };

  return details.refs.map((ref) => {
    counters[ref.role] += 1;

    const numberInRole = counters[ref.role];
    const isUserRole = ref.role === USER_ROLE;
    const idStem = isUserRole ? "user-image" : IMAGE_ID_STEM;
    const paddedNumber = String(numberInRole).padStart(FILE_NUMBER_WIDTH, "0");

    return {
      id: `${idStem}-${numberInRole}`,
      role: ref.role,
      kind: IMAGE_ID_STEM,
      url: createChatGptFileUrl(ref.fileId),
      filename: `${idStem}-${paddedNumber}`,
      messageIndex: numberInRole - 1,
      createdAt: details.createdAt,
    };
  });
}

export async function readConversationReply(
  page: Page,
  conversationId: string,
): Promise<ConversationReply> {
  const apiPath = `/backend-api/conversation/${encodeURIComponent(conversationId)}`;
  return readChatGptApi<ConversationReply>(page, apiPath);
}

export async function readChatGptFileDownloadUrl(details: {
  page: Page;
  conversationId: string;
  fileId: string;
}): Promise<string> {
  const apiPath = `/backend-api/files/download/${encodeURIComponent(details.fileId)}?conversation_id=${encodeURIComponent(details.conversationId)}&inline=false`;
  const downloadReply = await readChatGptApi<ChatGptFileDownloadReply>(details.page, apiPath);

  const downloadUrl = downloadReply.download_url;

  const isDownloadUrlMissing = downloadUrl == null;
  if (isDownloadUrlMissing) {
    throw new Error(`ChatGPT returned no download link for file ${details.fileId}`);
  }

  return downloadUrl;
}
