import type { Locator } from "playwright";

/** Context for {@link firstVisibleIn}. */
export interface FirstVisibleInContext {
  /** Parent locator to search within. */
  parent: Locator;
  /** Candidate selectors to probe in order. */
  selectors: readonly string[];
}

/** Return the first visible child locator matching any selector, or null. */
export async function firstVisibleIn(ctx: FirstVisibleInContext): Promise<Locator | null> {
  for (const selector of ctx.selectors) {
    const locator = ctx.parent.locator(selector).first();
    if (await locator.count() > 0 && await locator.isVisible().catch(() => false)) {
      return locator;
    }
  }
  return null;
}
