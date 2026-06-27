import type { Locator } from "playwright";
import type { ConnectorSetupContext } from "./connector.types.ts";

/** Context for {@link findSelectedConnectorPill}. */
export interface FindSelectedConnectorPillContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: ConnectorSetupContext["page"];
  /** Connector display name to match in pill aria-labels. */
  connectorName: string;
}

/** Find the selected connector pill in the composer by aria-label. */
export async function findSelectedConnectorPill(ctx: FindSelectedConnectorPillContext): Promise<Locator | null> {
  const buttons = await ctx.page.locator('button[aria-label*="click to remove"]').all();
  for (const button of buttons) {
    const aria = await button.getAttribute("aria-label").catch(() => null);
    if (aria === `${ctx.connectorName}, click to remove`) return button;
  }
  return null;
}

/** Context for {@link isConnectorSelectedInComposer}. */
export interface IsConnectorSelectedInComposerContext {
  /** Connector setup context with page and connector name. */
  setup: ConnectorSetupContext;
}

/** True when the desired connector pill is already selected in the composer. */
export async function isConnectorSelectedInComposer(ctx: IsConnectorSelectedInComposerContext): Promise<boolean> {
  return !!await findSelectedConnectorPill({ page: ctx.setup.page, connectorName: ctx.setup.connectorName });
}

/** Remove stale bridge connector pills that are not the desired connector. */
export async function removeStaleBridgeConnectorPills(ctx: ConnectorSetupContext): Promise<void> {
  const buttons = await ctx.page.locator('button[aria-label*="ai-browser-bridge"][aria-label*="click to remove"]').all();
  for (const button of buttons) {
    const aria = await button.getAttribute("aria-label").catch(() => null);
    if (!aria || aria === `${ctx.connectorName}, click to remove`) continue;
    await button.click({ timeout: 1_000, force: true }).catch(() => {});
    await ctx.page.waitForTimeout(250);
  }
}
