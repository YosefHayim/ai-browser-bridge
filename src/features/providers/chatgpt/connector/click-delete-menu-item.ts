import type { Page } from "playwright";
import { firstVisible } from "../dom/first-visible.ts";

/** Context for {@link clickDeleteMenuItem}. */
export interface ClickDeleteMenuItemContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/** Click Delete in the connector manage menu when visible. */
export async function clickDeleteMenuItem(ctx: ClickDeleteMenuItemContext) {
  return firstVisible({
    page: ctx.page,
    selectors: [
      '[role="menu"] [role="menuitem"]:has-text("Delete")',
      '[data-radix-menu-content] [role="menuitem"]:has-text("Delete")',
    ],
  });
}
