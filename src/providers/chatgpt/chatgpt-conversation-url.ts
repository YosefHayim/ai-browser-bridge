const CHATGPT_CONVERSATION_URL_PREFIX = "https://chatgpt.com/c/";
// Raw path shape: "/c/abc-def-123"
const CHATGPT_CONVERSATION_PATH = /\/c\/(?<conversationId>[^/?#]+)/;

export const readChatGptConversationIdFromUrl = (url: string): string | null => {
  const conversationId = CHATGPT_CONVERSATION_PATH.exec(url)?.groups?.conversationId;

  const isConversationIdMissing = conversationId === undefined;
  if (isConversationIdMissing) return null;

  return conversationId;
};

export const readChatGptConversationUrlFromIdOrUrl = (value: string): string => {
  const trimmed = value.trim();
  const isHttpUrlText = trimmed.startsWith("http://") || trimmed.startsWith("https://");
  if (isHttpUrlText) return trimmed;

  return `${CHATGPT_CONVERSATION_URL_PREFIX}${trimmed}`;
};

export const isSameChatGptConversation = (pageUrl: string, targetIdOrUrl: string): boolean => {
  const targetId = readChatGptConversationIdFromUrl(
    readChatGptConversationUrlFromIdOrUrl(targetIdOrUrl),
  );
  const currentId = readChatGptConversationIdFromUrl(pageUrl);

  const isTargetIdMissing = targetId === null;
  if (isTargetIdMissing) return false;

  return targetId === currentId;
};
