import type { Page } from "playwright";
import { clickFirstVisible } from "../dom/click-first-visible.ts";

/** Context for {@link clickDeleteConfirmation}. */
export interface ClickDeleteConfirmationContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/** Confirm connector deletion in the alert or dialog that appears. */
export async function clickDeleteConfirmation(ctx: ClickDeleteConfirmationContext): Promise<void> {
  await clickFirstVisible({
    page: ctx.page,
    selectors: [
      '[role="alertdialog"] button:has-text("Delete")',
      '[role="dialog"] button:has-text("Delete")',
      'button:has-text("Delete app")',
      'button:has-text("Delete App")',
    ],
    timeout: 1_000,
  });
  await ctx.page.waitForTimeout(2_000);
}
