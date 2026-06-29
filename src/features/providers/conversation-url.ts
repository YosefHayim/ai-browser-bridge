/** Extract a ChatGPT `/c/<id>` conversation id from a URL, or null when absent. */
export function conversationIdFromUrl(url: string): string | null {
  const match = /\/c\/([^/?#]+)/.exec(url);
  return match?.[1] ?? null;
}

/** Normalize a conversation flag (id or full URL) to a canonical ChatGPT thread URL. */
export function conversationUrlFromIdOrUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return `https://chatgpt.com/c/${trimmed}`;
}

/** True when `pageUrl` is already on the same ChatGPT conversation as `target`. */
export function isSameChatGptConversation(pageUrl: string, targetIdOrUrl: string): boolean {
  const targetId = conversationIdFromUrl(conversationUrlFromIdOrUrl(targetIdOrUrl));
  const currentId = conversationIdFromUrl(pageUrl);
  return !!targetId && targetId === currentId;
}
