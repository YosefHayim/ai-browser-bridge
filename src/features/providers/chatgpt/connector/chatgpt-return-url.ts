/** Context for {@link chatGptReturnUrl}. */
export interface ChatGptReturnUrlContext {
  /** Current browser URL to normalize into a restorable ChatGPT location. */
  url: string;
}

/** Normalize a ChatGPT URL into a conversation or home URL suitable for restoration. */
export function chatGptReturnUrl(ctx: ChatGptReturnUrlContext): string | null {
  try {
    const parsed = new URL(ctx.url);
    if (!parsed.hostname.endsWith("chatgpt.com")) return null;
    parsed.hash = "";
    parsed.search = "";
    if (parsed.pathname.startsWith("/c/")) return parsed.toString();
    return `${parsed.origin}/`;
  } catch {
    return null;
  }
}
