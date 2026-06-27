import type { Locator } from "playwright";
import type { ConnectorSetupContext } from "./connector.types.ts";

/** Context for {@link clickMoreMenuItem}. */
export interface ClickMoreMenuItemContext {
  /** More submenu item locator. */
  moreItem: Locator;
  /** Connector setup context with page handle. */
  setup: ConnectorSetupContext;
}

/** Hover and click the More submenu entry in the composer menu. */
export async function clickMoreMenuItem(ctx: ClickMoreMenuItemContext): Promise<void> {
  await ctx.moreItem.hover().catch(() => {});
  await ctx.moreItem.click({ timeout: 2_000, force: true }).catch(() => {});
  await ctx.setup.page.waitForTimeout(750);
}
