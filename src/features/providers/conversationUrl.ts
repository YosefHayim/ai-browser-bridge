/**
 * Extract a ChatGPT `/c/<id>` conversation id from a URL, or null when absent.
 *
 * @param url - Url value.
 * @returns The `conversationIdFromUrl` result.
 * @example
 * ```ts
 * const result = conversationIdFromUrl(url);
 * ```
 */
export const conversationIdFromUrl = (url: string): string | null => {
  const match = /\/c\/([^/?#]+)/.exec(url);
  return match?.[1] ?? null;
};

/**
 * Normalize a conversation flag (id or full URL) to a canonical ChatGPT thread URL.
 *
 * @param value - Value value.
 * @returns The `conversationUrlFromIdOrUrl` result.
 * @example
 * ```ts
 * const result = conversationUrlFromIdOrUrl(value);
 * ```
 */
export const conversationUrlFromIdOrUrl = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return `https://chatgpt.com/c/${trimmed}`;
};

/**
 * True when `pageUrl` is already on the same ChatGPT conversation as `target`.
 *
 * @param pageUrl - Page url value.
 * @param targetIdOrUrl - Target id or url value.
 * @returns Whether the condition matches.
 * @example
 * ```ts
 * const result = isSameChatGptConversation(pageUrl, targetIdOrUrl);
 * ```
 */
export const isSameChatGptConversation = (pageUrl: string, targetIdOrUrl: string): boolean => {
  const targetId = conversationIdFromUrl(conversationUrlFromIdOrUrl(targetIdOrUrl));
  const currentId = conversationIdFromUrl(pageUrl);
  return !!targetId && targetId === currentId;
};
