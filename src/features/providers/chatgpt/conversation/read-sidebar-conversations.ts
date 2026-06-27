import type { Page } from "playwright";
import { SELECTORS } from "../selectors.config.ts";
import { parseSidebarLink } from "./parse-sidebar-link.ts";

/** Read the conversation list from the sidebar. */
export async function readSidebarConversations(page: Page): Promise<Array<{ id: string; title: string; url: string }>> {
  const links = await page.locator(SELECTORS.sidebarConversation).all();
  const conversations: Array<{ id: string; title: string; url: string }> = [];
  for (const link of links) {
    const entry = await parseSidebarLink({ link });
    if (entry) conversations.push(entry);
  }
  return conversations;
}
