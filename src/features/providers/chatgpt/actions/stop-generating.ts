import type { Page } from "playwright";
import { SELECTORS } from "../selectors.config.ts";

/** Stop the active streaming response when ChatGPT exposes the stop button. */
export async function stopGenerating(page: Page, timeout = 5_000): Promise<boolean> {
  const stop = page.locator(SELECTORS.streamingIndicator).first();
  try {
    await stop.waitFor({ state: "visible", timeout });
  } catch {
    return false;
  }
  await stop.click();
  return true;
}
