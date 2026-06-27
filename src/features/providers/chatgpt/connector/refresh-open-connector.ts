import { clickFirstVisible } from "../dom/click-first-visible.ts";
import type { ConnectorSetupContext } from "./connector.types.ts";

/** Refresh the currently open connector tool schema when the button is visible. */
export async function refreshOpenConnectorIfPresent(ctx: ConnectorSetupContext): Promise<boolean> {
  return clickFirstVisible({
    page: ctx.page,
    selectors: ['[role="dialog"] button:has-text("Refresh")'],
    timeout: 1_000,
  });
}
