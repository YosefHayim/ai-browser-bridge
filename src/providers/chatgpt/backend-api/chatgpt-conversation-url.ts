export function readChatGptConversationIdFromUrl(url: string): string | null {
  const conversationId = /\/c\/(?<conversationId>[^/?#]+)/.exec(url)?.groups?.conversationId;

  const isConversationIdMissing = conversationId == null;
  if (isConversationIdMissing) return null;

  return conversationId;
}

export function readChatGptConversationUrlFromIdOrUrl(field: string): string {
  const trimmed = field.trim();

  const isHttpUrlString = trimmed.startsWith("http://") || trimmed.startsWith("https://");
  if (isHttpUrlString) return trimmed;

  return `${"https://chatgpt.com/c/"}${trimmed}`;
}

export function isSameChatGptConversation(pageUrl: string, targetIdOrUrl: string): boolean {
  const targetConversationUrl = readChatGptConversationUrlFromIdOrUrl(targetIdOrUrl);
  const targetId = readChatGptConversationIdFromUrl(targetConversationUrl);
  const currentId = readChatGptConversationIdFromUrl(pageUrl);

  const isTargetIdMissing = targetId == null;
  if (isTargetIdMissing) return false;

  return targetId === currentId;
}

export function stripConversationId(idOrUrl: string): string {
  const conversationId = readChatGptConversationIdFromUrl(idOrUrl);

  const isConversationIdMissing = conversationId == null;
  if (isConversationIdMissing) return idOrUrl;

  return conversationId;
}

export function looksLikeConversationId(conversationId: string): boolean {
  // The first two groups of a UUID.
  return /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(conversationId);
}
