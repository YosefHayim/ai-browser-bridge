import type { Locator } from "playwright";

/** A sidebar conversation entry parsed from a nav link. */
export interface SidebarConversationEntry {
  /** Conversation id from the URL path segment. */
  id: string;
  /** Visible title text from the sidebar link. */
  title: string;
  /** Absolute ChatGPT URL for the conversation. */
  url: string;
}

/** Context for {@link parseSidebarLink}. */
export interface ParseSidebarLinkContext {
  /** Sidebar conversation link locator. */
  link: Locator;
}

/** Parse one sidebar link into a conversation entry, or null when incomplete. */
export async function parseSidebarLink(ctx: ParseSidebarLinkContext): Promise<SidebarConversationEntry | null> {
  const href = await ctx.link.getAttribute("href");
  const title = await ctx.link.innerText();
  if (!href || !title) return null;
  const id = href.split("/").pop() ?? "";
  return { id, title: title.trim(), url: `https://chatgpt.com${href}` };
}
