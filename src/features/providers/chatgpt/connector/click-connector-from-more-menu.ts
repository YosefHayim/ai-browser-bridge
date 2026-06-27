import type { ConnectorSetupContext } from "./connector.types.ts";
import { clickConnectorMenuItem } from "./click-connector-menu-item.ts";
import { hoverAndClickMoreMenuItem } from "./hover-and-click-more-menu-item.ts";

/** Click the connector entry from the composer More submenu when needed. */
export async function clickConnectorFromMoreMenu(ctx: ConnectorSetupContext): Promise<boolean> {
  if (!await hoverAndClickMoreMenuItem({ setup: ctx })) return false;
  return clickConnectorMenuItem({ page: ctx.page, connectorName: ctx.connectorName });
}
