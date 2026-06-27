import type { Page } from "playwright";
import { SELECTORS } from "../selectors.config.ts";

/** Context for {@link hasGuestLoginButtons}. */
export interface HasGuestLoginButtonsContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/** True when ChatGPT shows login or signup CTAs for guest users. */
export async function hasGuestLoginButtons(ctx: HasGuestLoginButtonsContext): Promise<boolean> {
  const login = ctx.page.locator('[data-testid="login-button"]');
  if (await login.isVisible({ timeout: 1500 }).catch(() => false)) return true;
  const signup = ctx.page.locator('[data-testid="signup-button"]');
  return signup.isVisible({ timeout: 500 }).catch(() => false);
}
