import type { Page } from "playwright";
import { SELECTORS } from "../selectors.config.ts";
import { captureLastResponse } from "../conversation/capture-last-response.ts";
import { normalizeDisplayText } from "../dom/normalize-display-text.ts";

/** Context for {@link isStreamingVisible}. */
export interface IsStreamingVisibleContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/** True when ChatGPT's stop/streaming indicator is visible. */
export async function isStreamingVisible(ctx: IsStreamingVisibleContext): Promise<boolean> {
  return ctx.page.locator(SELECTORS.streamingIndicator).first().isVisible().catch(() => false);
}

/** Context for {@link readNormalizedLastResponse}. */
export interface ReadNormalizedLastResponseContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/** Read and normalize the last assistant response text. */
export async function readNormalizedLastResponse(ctx: ReadNormalizedLastResponseContext): Promise<string> {
  const text = await captureLastResponse(ctx.page).catch(() => "");
  return normalizeDisplayText({ value: text });
}
