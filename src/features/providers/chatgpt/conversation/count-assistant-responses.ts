import type { Page } from "playwright";
import { SELECTORS } from "../selectors.config.ts";

/** Count assistant responses currently rendered in the conversation. */
export async function countAssistantResponses(page: Page): Promise<number> {
  return page.locator(SELECTORS.responseBlock).count();
}
