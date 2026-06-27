import type { Page } from "playwright";
import type { Locator } from "playwright";
import { SELECTORS } from "../selectors.config.ts";
import { detectCurrentModel } from "./detect-current-model.ts";

/** Context for {@link clickModelAndDetect}. */
export interface ClickModelAndDetectContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
  /** Model menu item to click. */
  item: Locator;
}

/** Click a model item, wait for the menu to close, and return the detected model. */
export async function clickModelAndDetect(ctx: ClickModelAndDetectContext): Promise<string> {
  await ctx.item.click();
  await ctx.page.locator(SELECTORS.openMenu).waitFor({ state: "hidden", timeout: 5_000 }).catch(() => {});
  await ctx.page.waitForTimeout(500);
  return detectCurrentModel(ctx.page);
}
