import type { Page } from "playwright";
import { SELECTORS } from "./selectors.config.ts";
import { CAPTURE_ALL_MESSAGES_SNIPPET } from "./capture-response.dom-snippet.ts";

function normalizeDisplayText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function stripGeminiResponseHeading(text: string): string {
  return text.replace(/^Gemini said\s*/i, "").trim();
}

/** Extract the text content of the last assistant response. */
export async function captureLastResponse(page: Page): Promise<string> {
  const blocks = page.locator(SELECTORS.responseBlock);
  const count = await blocks.count();
  if (count === 0) return "";
  const text = normalizeDisplayText(await blocks.nth(count - 1).innerText().catch(() => ""));
  return stripGeminiResponseHeading(text);
}

/** Count assistant responses currently rendered in the conversation. */
export async function countAssistantResponses(page: Page): Promise<number> {
  return page.locator(SELECTORS.responseBlock).count();
}

/** Extract all messages from the current conversation in DOM order. */
export async function captureAllMessages(page: Page): Promise<Array<{ role: string; content: string }>> {
  return page.evaluate(CAPTURE_ALL_MESSAGES_SNIPPET);
}
