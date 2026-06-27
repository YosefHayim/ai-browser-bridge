import type { Page } from "playwright";
import type { Locator } from "playwright";
import { normalizeConnectorListLabel } from "./connector-summary-helpers.ts";

/** Context for {@link findConnectorButton}. */
export interface FindConnectorButtonContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
  /** Connector display name to locate in the list. */
  connectorName: string;
}

/** Find a connector list button by exact normalized label. */
export async function findConnectorButton(ctx: FindConnectorButtonContext): Promise<Locator | null> {
  const buttons = await ctx.page.locator('[role="dialog"] button').all();
  for (const button of buttons) {
    const label = normalizeConnectorListLabel({ value: await button.innerText().catch(() => "") });
    if (label === ctx.connectorName) return button;
  }
  return null;
}

/** Context for {@link waitForConnectorButton}. */
export interface WaitForConnectorButtonContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
  /** Connector display name to wait for. */
  connectorName: string;
  /** Maximum wait time in milliseconds. */
  timeoutMs: number;
}

/** Poll until a connector button becomes visible in settings. */
export async function waitForConnectorButton(ctx: WaitForConnectorButtonContext): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < ctx.timeoutMs) {
    const button = await findConnectorButton({ page: ctx.page, connectorName: ctx.connectorName });
    if (button && await button.isVisible().catch(() => false)) return true;
    await ctx.page.waitForTimeout(500);
  }
  return false;
}
