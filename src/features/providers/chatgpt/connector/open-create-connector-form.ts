import { clickFirstVisible } from "../dom/click-first-visible.ts";
import type { ConnectorSetupContext } from "./connector.types.ts";

/** Open the connector/app creation form from settings. */
export async function openCreateConnectorForm(ctx: ConnectorSetupContext): Promise<void> {
  const opened = await clickFirstVisible({
    page: ctx.page,
    selectors: [
      'button:has-text("Create app")',
      'button:has-text("Create App")',
      'button:has-text("Create")',
      'button:has-text("Add connector")',
      'button:has-text("Add Connector")',
      'button:has-text("New app")',
      'button:has-text("New App")',
      'button:has-text("Connect")',
    ],
    timeout: 2_000,
  });
  if (opened) {
    ctx.result.steps.push("Opened connector/app creation form.");
  } else {
    ctx.result.warnings.push("Could not find Create app/Add connector. Use Settings -> Apps -> Advanced settings -> Create app manually.");
  }
}
