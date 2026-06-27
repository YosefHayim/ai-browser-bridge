import type { Locator, Page } from "playwright";

/** Context for {@link clickConnectorEntryButton}. */
export interface ClickConnectorEntryButtonContext {
  /** Connector list button locator. */
  button: Locator;
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/** Click a connector list entry and wait for its detail panel. */
export async function clickConnectorEntryButton(ctx: ClickConnectorEntryButtonContext): Promise<void> {
  await ctx.button.click({ timeout: 3_000, force: true });
  await ctx.page.waitForTimeout(1_000);
}
