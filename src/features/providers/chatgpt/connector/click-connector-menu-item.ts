import type { ConnectorSetupContext } from "./connector.types.ts";

/** Context for {@link clickConnectorMenuItem}. */
export interface ClickConnectorMenuItemContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: ConnectorSetupContext["page"];
  /** Connector display name to click in the menu. */
  connectorName: string;
}

/** Click a connector entry in the composer plus-menu. */
export async function clickConnectorMenuItem(ctx: ClickConnectorMenuItemContext): Promise<boolean> {
  const item = ctx.page.locator(`[role="menu"] [role="menuitem"]:has-text("${ctx.connectorName}"), [role="menu"] button:has-text("${ctx.connectorName}"), [role="menu"] :text-is("${ctx.connectorName}")`).last();
  if (!await item.isVisible().catch(() => false)) return false;
  await item.click({ timeout: 3_000, force: true });
  await ctx.page.waitForTimeout(500);
  return true;
}
