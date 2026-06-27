import type { Page } from "playwright";
import type { Locator } from "playwright";

/** Return all model menu item locators from the open model switcher menu. */
export async function modelMenuItems(page: Page): Promise<Locator[]> {
  return page.locator(
    [
      '[role="menu"] [role="menuitem"]',
      '[role="menu"] [role="menuitemradio"]',
      '[data-radix-menu-content] [role="menuitem"]',
      '[data-radix-menu-content] [role="menuitemradio"]',
      '[role="menu"] [data-testid^="model-switcher-"]',
      '[data-radix-menu-content] [data-testid^="model-switcher-"]',
    ].join(", "),
  ).all();
}
