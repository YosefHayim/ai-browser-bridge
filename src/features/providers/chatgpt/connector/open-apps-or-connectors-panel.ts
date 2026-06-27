import { clickFirstVisible } from "../dom/click-first-visible.ts";
import type { ConnectorSetupContext } from "./connector.types.ts";

/** Open the Apps or Connectors panel inside ChatGPT settings. */
export async function openAppsOrConnectorsPanel(ctx: ConnectorSetupContext): Promise<void> {
  const opened = await clickFirstVisible({
    page: ctx.page,
    selectors: [
      'button:has-text("Apps")',
      'a:has-text("Apps")',
      '[role="tab"]:has-text("Apps")',
      'button:has-text("Connectors")',
      'a:has-text("Connectors")',
      '[role="tab"]:has-text("Connectors")',
    ],
    timeout: 2_000,
  });
  if (opened) {
    ctx.result.steps.push("Opened Apps/Connectors settings.");
  } else {
    ctx.result.warnings.push("Could not find Apps/Connectors in settings. Use Settings -> Apps manually.");
  }
}
