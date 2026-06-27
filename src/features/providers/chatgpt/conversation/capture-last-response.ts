import type { Page } from "playwright";
import { extractAssistantContent } from "../attachments/extract-messages.ts";
import { conversationIdFromPage } from "./conversation-id-from-page.ts";

/** Extract the text content of the last assistant response. */
export async function captureLastResponse(page: Page): Promise<string> {
  const { text } = await extractAssistantContent(page, {
    conversationId: conversationIdFromPage({ page }),
  });
  return text;
}
