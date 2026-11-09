import type { Page } from "playwright";
import type { Attachment, AttachmentRole } from "@/domain/attachment-types.ts";
import { readChatGptApi } from "./chatgpt-backend-api.ts";

// Prefix for Attachment.url of images listed by the conversation API. The file id follows it.
const CHATGPT_FILE_URL_PREFIX = "chatgpt-file:";
const ASSET_POINTER_PATTERN = /^(?:file-service|sediment):\/\/(?<fileId>.+)$/;
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

const createChatGptFileUrl = (fileId: string): string => {
  return `${CHATGPT_FILE_URL_PREFIX}${fileId}`;
};

export const isChatGptFileUrl = (url: string): boolean => {
  return url.startsWith(CHATGPT_FILE_URL_PREFIX);
};

export const fileIdFromChatGptFileUrl = (url: string): string => {
  return url.slice(CHATGPT_FILE_URL_PREFIX.length);
};

const isMessage = (
  message: ConversationMessage | null | undefined,
): message is ConversationMessage => {
  return message !== null && message !== undefined;
};

const isImagePointerPart = (part: unknown): part is ImagePointerPart => {
  if (typeof part !== "object" || part === null) return false;
  return "content_type" in part && part.content_type === "image_asset_pointer";
};

const fileIdFromAssetPointer = (assetPointer: string): string => {
  const pointerMatch = ASSET_POINTER_PATTERN.exec(assetPointer);
  const fileId = pointerMatch?.groups?.fileId;
  if (fileId === undefined) throw new Error("ChatGPT image pointer has an unknown scheme.");
  return fileId;
};

const imageRefsInMessage = (message: ConversationMessage): ConversationImageRef[] => {
  const parts = message.content?.parts ?? [];
  const role: AttachmentRole = message.author?.role === "user" ? "user" : "assistant";
  const createTime = message.create_time ?? 0;
  return parts.filter(isImagePointerPart).map((part) => ({
    fileId: fileIdFromAssetPointer(part.asset_pointer),
    role,
    createTime,
  }));
};

export const listConversationImageRefs = (
  conversation: ConversationReply,
): ConversationImageRef[] => {
  const messages = Object.values(conversation.mapping)
    .map((node) => node.message)
    .filter(isMessage);
  const imageRefs = messages.flatMap(imageRefsInMessage);
  return imageRefs.sort((first, second) => first.createTime - second.createTime);
};

export const attachmentsFromImageRefs = (input: {
  refs: ConversationImageRef[];
  createdAt: string;
}): Attachment[] => {
  const counters: Record<AttachmentRole, number> = { assistant: 0, user: 0 };
  return input.refs.map((ref) => {
    counters[ref.role] += 1;
    const numberInRole = counters[ref.role];
    const idStem = ref.role === "user" ? "user-image" : "image";
    const paddedNumber = String(numberInRole).padStart(FILE_NUMBER_WIDTH, "0");
    return {
      id: `${idStem}-${numberInRole}`,
      role: ref.role,
      kind: "image",
      url: createChatGptFileUrl(ref.fileId),
      filename: `${idStem}-${paddedNumber}`,
      messageIndex: numberInRole - 1,
      createdAt: input.createdAt,
    };
  });
};

export const readConversationReply = async (
  page: Page,
  conversationId: string,
): Promise<ConversationReply> => {
  const apiPath = `/backend-api/conversation/${encodeURIComponent(conversationId)}`;
  return readChatGptApi<ConversationReply>(page, apiPath);
};

export const readChatGptFileDownloadUrl = async (input: {
  page: Page;
  conversationId: string;
  fileId: string;
}): Promise<string> => {
  const apiPath = `/backend-api/files/download/${encodeURIComponent(input.fileId)}?conversation_id=${encodeURIComponent(input.conversationId)}&inline=false`;
  const downloadReply = await readChatGptApi<ChatGptFileDownloadReply>(input.page, apiPath);
  if (downloadReply.download_url === undefined) {
    throw new Error(`ChatGPT returned no download link for file ${input.fileId}`);
  }
  return downloadReply.download_url;
};
