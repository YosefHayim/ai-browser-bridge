import { firstVisible } from "../dom/first-visible.ts";
import type { ConnectorSetupContext } from "./connector.types.ts";
import { clickConnectorMenuItem } from "./click-connector-menu-item.ts";
import { clickConnectorFromMoreMenu } from "./click-connector-from-more-menu.ts";

/** Context for {@link openComposerPlusMenu}. */
export interface OpenComposerPlusMenuContext {
  /** Connector setup context with page handle. */
  setup: ConnectorSetupContext;
}

/** Open the composer plus-menu for connector selection. */
export async function openComposerPlusMenu(ctx: OpenComposerPlusMenuContext): Promise<boolean> {
  const plusButton = await firstVisible({
    page: ctx.setup.page,
    selectors: [
      '[data-testid="composer-plus-btn"]',
      'button[aria-label="Add files and more"]',
      'button[aria-label*="Add files" i]',
    ],
  });
  if (!plusButton) return false;
  await plusButton.click({ timeout: 5_000, force: true });
  await ctx.setup.page.waitForTimeout(750);
  return true;
}

/** Open the composer plus-menu and choose the connector, including More submenu. */
export async function openComposerConnectorMenu(ctx: ConnectorSetupContext): Promise<boolean> {
  if (!await openComposerPlusMenu({ setup: ctx })) return false;
  if (await clickConnectorMenuItem({ page: ctx.page, connectorName: ctx.connectorName })) return true;
  return clickConnectorFromMoreMenu(ctx);
}
