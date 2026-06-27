import type { Page } from "playwright";
import { firstVisible } from "./first-visible.ts";

/** Context for {@link clickFirstVisible}. */
export interface ClickFirstVisibleContext {
  /** Playwright page handle to search within. */
  page: Page;
  /** Candidate selectors to click in order. */
  selectors: readonly string[];
  /** Per-selector visibility wait timeout in milliseconds. */
  timeout?: number;
}

/** Click the first visible element matching any selector; return whether a click succeeded. */
export async function clickFirstVisible(ctx: ClickFirstVisibleContext): Promise<boolean> {
  const timeout = ctx.timeout ?? 1_000;
  for (const selector of ctx.selectors) {
    const locator = ctx.page.locator(selector).first();
    await locator.waitFor({ state: "visible", timeout }).catch(() => {});
    if (await locator.count() > 0 && await locator.isVisible().catch(() => false)) {
      try {
        await locator.click({ timeout });
        return true;
      } catch {
        try {
          await locator.click({ timeout, force: true });
          return true;
        } catch {
          continue;
        }
      }
    }
  }
  return false;
}
