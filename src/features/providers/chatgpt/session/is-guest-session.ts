import type { Page } from "playwright";
import { hasGuestLoginButtons } from "./has-guest-login-buttons.ts";
import { hasVisibleAccountMenu } from "./has-visible-account-menu.ts";
import { hasVisibleComposer } from "./has-visible-composer.ts";

/** True when ChatGPT is showing the unauthenticated guest shell. */
export async function isGuestSession(page: Page): Promise<boolean> {
  if (await hasVisibleAccountMenu({ page })) return false;
  if (await hasGuestLoginButtons({ page })) return true;
  return !(await hasVisibleComposer({ page }));
}
