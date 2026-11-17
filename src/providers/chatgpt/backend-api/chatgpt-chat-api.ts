import type { Page } from "playwright";
import {
  type ChatGptApiReply,
  type ChatGptApiReplyStatus,
  readChatGptApiReplyStatus,
  requestChatGptApi,
} from "@/providers/chatgpt/backend-api/api-requests.ts";
import { searchChatGptConversationByTitle } from "@/providers/chatgpt/backend-api/chatgpt-conversation-search.ts";
import {
  looksLikeConversationId,
  stripConversationId,
} from "@/providers/chatgpt/backend-api/chatgpt-conversation-url.ts";
import type {
  MoveChatVerdict,
  RenamedChat,
} from "@/providers/chatgpt/backend-api/chatgpt-workspace-types.ts";

type ConversationApiRead = {
  state: ChatGptApiReplyStatus;
  status: number;
  conversationTemplateId: string | null;
};

function readConversationApiPath(conversationId: string): string {
  return `/backend-api/conversation/${encodeURIComponent(conversationId)}`;
}

function markMoveRateLimited(base: MoveChatVerdict): MoveChatVerdict {
  return {
    ...base,
    rateLimited: true,
    reason: "ChatGPT rate limit (HTTP 429)",
  };
}

function requireChatGptReplyOk(reply: ChatGptApiReply, action: string): void {
  const replyStatus = readChatGptApiReplyStatus(reply.status);

  const isReplyOk = replyStatus === "ok";
  if (isReplyOk) return;

  const isRateLimited = replyStatus === "rate-limited";
  if (isRateLimited) {
    throw new Error(`ChatGPT rate-limited the chat ${action} (HTTP 429). Resume later.`);
  }

  throw new Error(`ChatGPT chat ${action} failed with HTTP ${reply.status}.`);
}

export class ChatGptChatApi {
  constructor(private readonly page: Page) {}

  // A 429 is reported as rateLimited so the queue defers the item without spending an attempt.
  moveChatToProject = async (
    chat: string,
    project: string,
    projectId: string,
  ): Promise<MoveChatVerdict> => {
    const base: MoveChatVerdict = { chat, project, moved: false };
    const conversationId = await this.findConversationId(chat);

    const isChatMissing = conversationId == null;
    if (isChatMissing) return { ...base, reason: `no chat titled "${chat}"` };

    const before = await this.readConversation(conversationId);

    const isBeforeRateLimited = before.state === "rate-limited";
    if (isBeforeRateLimited) return markMoveRateLimited(base);

    const isBeforeFailed = before.state === "failed";
    if (isBeforeFailed) {
      return { ...base, reason: `ChatGPT returned HTTP ${before.status} for the chat` };
    }

    const isAlreadyFiled = before.conversationTemplateId === projectId;
    if (isAlreadyFiled) {
      return { ...base, alreadyFiled: true, reason: `already in project "${project}"` };
    }

    const moveReply = await requestChatGptApi(this.page, {
      method: "PATCH",
      apiPath: readConversationApiPath(conversationId),
      body: { gizmo_id: projectId },
    });
    const moveStatus = readChatGptApiReplyStatus(moveReply.status);

    const isMoveRateLimited = moveStatus === "rate-limited";
    if (isMoveRateLimited) return markMoveRateLimited(base);

    const isMoveFailed = moveStatus === "failed";
    if (isMoveFailed) {
      return {
        ...base,
        reason: `ChatGPT rejected the move into project "${project}" (HTTP ${moveReply.status})`,
      };
    }

    const after = await this.readConversation(conversationId);

    const isAfterRateLimited = after.state === "rate-limited";
    if (isAfterRateLimited) return markMoveRateLimited(base);

    const isNotMoveConfirmed = after.conversationTemplateId !== projectId;
    if (isNotMoveConfirmed) {
      return { ...base, reason: `ChatGPT did not confirm the move into project "${project}"` };
    }

    return { ...base, moved: true };
  };

  renameChat = async (chat: string, title: string): Promise<RenamedChat> => {
    const conversationId = await this.findConversationId(chat);

    const isChatMissing = conversationId == null;
    if (isChatMissing) throw new Error(`no chat titled "${chat}"`);

    const renameReply = await requestChatGptApi(this.page, {
      method: "PATCH",
      apiPath: readConversationApiPath(conversationId),
      body: { title },
    });
    requireChatGptReplyOk(renameReply, "rename");

    const confirmReply = await requestChatGptApi(this.page, {
      method: "GET",
      apiPath: readConversationApiPath(conversationId),
    });
    requireChatGptReplyOk(confirmReply, "rename check");
    const conversation = JSON.parse(confirmReply.bodyText);

    const isNotTitleConfirmed = conversation.title !== title;
    if (isNotTitleConfirmed) {
      throw new Error(`ChatGPT did not confirm the new title for chat ${conversationId}.`);
    }

    return { id: conversationId, title };
  };

  private readConversation = async (conversationId: string): Promise<ConversationApiRead> => {
    const reply = await requestChatGptApi(this.page, {
      method: "GET",
      apiPath: readConversationApiPath(conversationId),
    });
    const replyStatus = readChatGptApiReplyStatus(reply.status);

    const isNotReadOk = replyStatus !== "ok";
    if (isNotReadOk) {
      return { state: replyStatus, status: reply.status, conversationTemplateId: null };
    }

    const conversation = JSON.parse(reply.bodyText);
    return {
      state: replyStatus,
      status: reply.status,
      conversationTemplateId: conversation.conversation_template_id,
    };
  };

  private findConversationId = async (chat: string): Promise<string | null> => {
    const conversationId = stripConversationId(chat);

    const isIdentifier = looksLikeConversationId(conversationId);
    if (isIdentifier) return conversationId;

    const exactReport = await searchChatGptConversationByTitle(this.page, chat);
    return exactReport?.id ?? null;
  };
}
