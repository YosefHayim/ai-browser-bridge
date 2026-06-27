import type { Page } from "playwright";
import { extractAllMessages } from "../attachments/extract-messages.ts";
import { conversationIdFromPage } from "./conversation-id-from-page.ts";

/** Extract all messages from the current conversation in DOM order. */
export async function captureAllMessages(page: Page): Promise<Array<{ role: string; content: string }>> {
  return extractAllMessages(page, { conversationId: conversationIdFromPage({ page }) });
}
