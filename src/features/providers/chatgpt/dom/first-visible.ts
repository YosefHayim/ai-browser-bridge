import type { Page } from "playwright";
import type { Locator } from "playwright";

/** Context for {@link firstVisible}. */
export interface FirstVisibleContext {
  /** Playwright page handle to search within. */
  page: Page;
  /** Candidate selectors to probe in order. */
  selectors: readonly string[];
}

/** Return the first visible locator matching any selector, or null. */
export async function firstVisible(ctx: FirstVisibleContext): Promise<Locator | null> {
  for (const selector of ctx.selectors) {
    const locator = ctx.page.locator(selector).first();
    if (await locator.count() > 0 && await locator.isVisible().catch(() => false)) {
      return locator;
    }
  }
  return null;
}
