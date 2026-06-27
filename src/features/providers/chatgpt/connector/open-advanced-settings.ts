import { clickFirstVisible } from "../dom/click-first-visible.ts";
import type { ConnectorSetupContext } from "./connector.types.ts";

/** Open Advanced settings when the control is visible in the connectors panel. */
export async function openAdvancedSettingsIfPresent(ctx: ConnectorSetupContext): Promise<void> {
  const opened = await clickFirstVisible({
    page: ctx.page,
    selectors: [
      'button:has-text("Advanced settings")',
      'button:has-text("Advanced Settings")',
      'a:has-text("Advanced settings")',
      '[role="tab"]:has-text("Advanced")',
      'button:has-text("Advanced")',
    ],
    timeout: 1_500,
  });
  if (opened) ctx.result.steps.push("Opened Advanced settings.");
}
