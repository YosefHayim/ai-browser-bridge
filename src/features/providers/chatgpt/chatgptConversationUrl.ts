const CHATGPT_CONVERSATION_URL_PREFIX = "https://chatgpt.com/c/";
const CHATGPT_CONVERSATION_PATH = /\/c\/([^/?#]+)/;

/**
 * Extract a ChatGPT conversation id from a browser URL.
 *
 * @param url - Browser URL that may point at a ChatGPT conversation.
 * @returns Conversation id from a ChatGPT `/c/<id>` URL, or null for other URLs.
 * @example
 * ```ts
 * const conversationId = chatGptConversationIdFromUrl("https://chatgpt.com/c/abc-123?model=gpt-4o");
 * ```
 */
export const chatGptConversationIdFromUrl = (url: string): string | null => {
  // Matches ChatGPT conversation URLs like https://chatgpt.com/c/abc-123?model=gpt-4o.
  // Capture group 1 is abc-123, the conversation id after /c/.
  const match = CHATGPT_CONVERSATION_PATH.exec(url);
  return match?.[1] ?? null;
};

/**
 * Build the canonical ChatGPT conversation URL for an id, or preserve a full URL.
 *
 * @param value - ChatGPT conversation id or already-normalized conversation URL.
 * @returns Full ChatGPT conversation URL.
 * @example
 * ```ts
 * const url = chatGptConversationUrlFromIdOrUrl("abc-123");
 * ```
 */
export const chatGptConversationUrlFromIdOrUrl = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return `${CHATGPT_CONVERSATION_URL_PREFIX}${trimmed}`;
};

/**
 * Check whether a page URL points at the same ChatGPT conversation as an id or URL.
 *
 * @param pageUrl - Current ChatGPT browser page URL.
 * @param targetIdOrUrl - Target ChatGPT conversation id or URL.
 * @returns True when both values resolve to the same ChatGPT conversation id.
 * @example
 * ```ts
 * const sameConversation = isSameChatGptConversation("https://chatgpt.com/c/abc-123", "abc-123");
 * ```
 */
export const isSameChatGptConversation = (pageUrl: string, targetIdOrUrl: string): boolean => {
  const targetId = chatGptConversationIdFromUrl(chatGptConversationUrlFromIdOrUrl(targetIdOrUrl));
  const currentId = chatGptConversationIdFromUrl(pageUrl);
  return !!targetId && targetId === currentId;
};
