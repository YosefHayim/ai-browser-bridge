import type { Page } from "playwright";
import { firstVisible } from "../dom/first-visible.ts";

/** Context for {@link openConnectorList}. */
export interface OpenConnectorListContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/** Navigate to the connector list and back out of any open detail panel. */
export async function openConnectorList(ctx: OpenConnectorListContext): Promise<void> {
  await ctx.page.goto("https://chatgpt.com/#settings/Connectors", { waitUntil: "domcontentloaded" }).catch(() => {});
  await ctx.page.waitForTimeout(1_000);
  const backButton = await firstVisible({
    page: ctx.page,
    selectors: ['[role="dialog"] button:has-text("Back")'],
  });
  if (backButton) {
    await backButton.click({ timeout: 2_000, force: true }).catch(() => {});
    await ctx.page.waitForTimeout(750);
  }
}
