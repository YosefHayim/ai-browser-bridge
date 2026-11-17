import type { Page } from "playwright";
import { readChatGptConversationIdFromUrl } from "@/providers/chatgpt/backend-api/chatgpt-conversation-url.ts";
import { SPACE } from "@/providers/chatgpt/page/chatgpt-page-constants.ts";
import { SELECTORS } from "@/providers/chatgpt/page/chatgpt-selectors.ts";
import {
  extractAllMessages,
  extractAssistantMessage,
} from "@/providers/chatgpt/page/extract-messages.ts";
import type { CaptureMessagesSettings } from "@/providers/engine/browser-provider.ts";
import { probeOrFallback, readVisibleCopy } from "@/providers/engine/browser-provider.ts";
import { waitForReplyIdle } from "@/providers/engine/streaming-guard.ts";

const CURRENT_STATUS = "current";

export async function captureAllMessages(
  page: Page,
  settings: CaptureMessagesSettings = {},
): Promise<Array<{ role: string; content: string }>> {
  const pageConversationId = readConversationIdFromPage({ page });
  return extractAllMessages(page, {
    conversationId: pageConversationId,
    manifestRoot: settings.manifestRoot,
  });
}

function sanitizeCapturedString(field: string): string {
  return field
    .replace(/\s*\[object Object\]\s*/g, SPACE)
    .replace(/\s+/g, SPACE)
    .trim();
}

export async function captureLastReply(
  page: Page,
  settings: CaptureMessagesSettings = {},
): Promise<string> {
  const assistantConversationId = readConversationIdFromPage({ page });
  const { text: string } = await extractAssistantMessage(page, {
    conversationId: assistantConversationId,
    manifestRoot: settings.manifestRoot,
  });

  const cleaned = sanitizeCapturedString(string);

  const isCleanedStringValid = cleaned && !/\[object Object\]/.test(string);
  if (isCleanedStringValid) return cleaned;

  const fallback = await probeOrFallback("", () =>
    readVisibleCopy(page.locator(SELECTORS.lastResponse).last()),
  );
  return sanitizeCapturedString(fallback) || cleaned;
}

type ConversationIdFromPageDetails = {
  page: Page;
};

function readConversationIdFromPage(details: ConversationIdFromPageDetails): string {
  const currentPageUrl = details.page.url();
  const conversationId = readChatGptConversationIdFromUrl(currentPageUrl);

  const isConversationIdMissing = conversationId == null;
  if (isConversationIdMissing) return CURRENT_STATUS;

  return conversationId;
}

export async function countAssistantReplies(page: Page): Promise<number> {
  return page.locator(SELECTORS.responseBlock).count();
}

export async function waitForGenerationIdle(
  page: Page,
  timeoutMilliseconds?: number,
): Promise<void> {
  await waitForReplyIdle(page, SELECTORS.streamingIndicator, timeoutMilliseconds);
}
