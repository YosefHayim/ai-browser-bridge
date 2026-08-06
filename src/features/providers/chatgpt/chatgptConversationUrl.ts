const CHATGPT_CONVERSATION_URL_PREFIX = "https://chatgpt.com/c/";
// Raw row example: "/c/abc-def-123" conversation path should match.
const CHATGPT_CONVERSATION_PATH = /\/c\/(?<conversationId>[^/?#]+)/;

/** Extract a ChatGPT conversation id from a browser URL. */
export const chatGptConversationIdFromUrl = (url: string): string | null => {
  const conversationId = CHATGPT_CONVERSATION_PATH.exec(url)?.groups?.conversationId;
  if (conversationId === undefined) return null;
  return conversationId;
};

/** Build the canonical ChatGPT conversation URL for an id, or preserve a full URL. */
export const chatGptConversationUrlFromIdOrUrl = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return `${CHATGPT_CONVERSATION_URL_PREFIX}${trimmed}`;
};

/** Check whether a page URL points at the same ChatGPT conversation as an id or URL. */
export const isSameChatGptConversation = (pageUrl: string, targetIdOrUrl: string): boolean => {
  const targetId = chatGptConversationIdFromUrl(chatGptConversationUrlFromIdOrUrl(targetIdOrUrl));
  const currentId = chatGptConversationIdFromUrl(pageUrl);
  if (targetId === null) return false;
  return targetId === currentId;
};
