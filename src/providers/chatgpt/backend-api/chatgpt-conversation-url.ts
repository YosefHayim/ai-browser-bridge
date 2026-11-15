export const readChatGptConversationIdFromUrl = (url: string): string | null => {
  const conversationId = /\/c\/(?<conversationId>[^/?#]+)/.exec(url)?.groups?.conversationId;

  const isConversationIdMissing = conversationId == null;
  if (isConversationIdMissing) return null;

  return conversationId;
};

export const readChatGptConversationUrlFromIdOrUrl = (field: string): string => {
  const trimmed = field.trim();

  const isHttpUrlString = trimmed.startsWith("http://") || trimmed.startsWith("https://");
  if (isHttpUrlString) return trimmed;

  return `${"https://chatgpt.com/c/"}${trimmed}`;
};

export const isSameChatGptConversation = (pageUrl: string, targetIdOrUrl: string): boolean => {
  const targetConversationUrl = readChatGptConversationUrlFromIdOrUrl(targetIdOrUrl);
  const targetId = readChatGptConversationIdFromUrl(targetConversationUrl);
  const currentId = readChatGptConversationIdFromUrl(pageUrl);

  const isTargetIdMissing = targetId == null;
  if (isTargetIdMissing) return false;

  return targetId === currentId;
};
