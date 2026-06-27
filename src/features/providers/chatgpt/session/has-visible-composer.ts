import type { Page } from "playwright";
import { SELECTORS } from "../selectors.config.ts";

/** Context for {@link hasVisibleComposer}. */
export interface HasVisibleComposerContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/** True when the prompt composer input is visible on the page. */
export async function hasVisibleComposer(ctx: HasVisibleComposerContext): Promise<boolean> {
  const prompt = ctx.page.locator(SELECTORS.promptInput);
  return prompt.first().isVisible({ timeout: 1500 }).catch(() => false);
}
