import type { Page } from "playwright";

/** Context for {@link conversationIdFromPage}. */
export interface ConversationIdFromPageContext {
  /** Playwright page handle whose URL may contain a conversation id. */
  page: Page;
}

/** Extract the `/c/{id}` segment from the current page URL, or `"current"`. */
export function conversationIdFromPage(ctx: ConversationIdFromPageContext): string {
  const match = /\/c\/([^/?#]+)/.exec(ctx.page.url());
  return match?.[1] ?? "current";
}
