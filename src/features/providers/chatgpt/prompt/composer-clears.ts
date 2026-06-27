import type { Page } from "playwright";
import { composerClearsOnce } from "./composer-clears-once.ts";

/** Context for {@link composerClears}. */
export interface ComposerClearsContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/**
 * Poll the composer until it empties, signalling the prompt was actually sent.
 *
 * Returns false once the poll budget is spent so the caller can re-send.
 */
export async function composerClears(ctx: ComposerClearsContext): Promise<boolean> {
  for (let poll = 0; poll < 10; poll += 1) {
    if (await composerClearsOnce({ page: ctx.page })) return true;
    await ctx.page.waitForTimeout(500);
  }
  return false;
}
