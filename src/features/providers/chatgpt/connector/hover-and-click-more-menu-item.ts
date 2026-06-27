import { firstVisible } from "../dom/first-visible.ts";
import type { ConnectorSetupContext } from "./connector.types.ts";
import { clickMoreMenuItem } from "./click-more-menu-item.ts";

/** Context for {@link hoverAndClickMoreMenuItem}. */
export interface HoverAndClickMoreMenuItemContext {
  /** Connector setup context with page handle. */
  setup: ConnectorSetupContext;
}

/** Hover and click the More submenu entry in the composer menu. */
export async function hoverAndClickMoreMenuItem(ctx: HoverAndClickMoreMenuItemContext): Promise<boolean> {
  const moreItem = await firstVisible({
    page: ctx.setup.page,
    selectors: [
      '[role="menuitem"][aria-haspopup="menu"]:has-text("More")',
      '[role="menuitem"]:has-text("More")',
    ],
  });
  if (!moreItem) return false;
  await clickMoreMenuItem({ moreItem, setup: ctx.setup });
  return true;
}
