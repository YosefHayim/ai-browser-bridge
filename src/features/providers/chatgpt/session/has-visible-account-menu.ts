import type { Page } from "playwright";
import { SELECTORS } from "../selectors.config.ts";

/** Context for {@link hasVisibleAccountMenu}. */
export interface HasVisibleAccountMenuContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/** True when the signed-in account/profile menu control is visible. */
export async function hasVisibleAccountMenu(ctx: HasVisibleAccountMenuContext): Promise<boolean> {
  const account = ctx.page.locator(SELECTORS.accountMenuButton.join(", "));
  return account.first().isVisible({ timeout: 2500 }).catch(() => false);
}
