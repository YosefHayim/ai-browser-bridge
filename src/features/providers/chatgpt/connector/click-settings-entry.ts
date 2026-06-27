import { clickFirstVisible } from "../dom/click-first-visible.ts";
import { SELECTORS } from "../selectors.config.ts";
import type { ConnectorSetupContext } from "./connector.types.ts";

/** Context for {@link clickSettingsEntry}. */
export interface ClickSettingsEntryContext {
  /** Connector setup context with page and result accumulator. */
  setup: ConnectorSetupContext;
}

/** Click Settings in the account menu and record the outcome. */
export async function clickSettingsEntry(ctx: ClickSettingsEntryContext): Promise<void> {
  const openedSettings = await clickFirstVisible({
    page: ctx.setup.page,
    selectors: SELECTORS.settingsEntrypoint,
    timeout: 2_000,
  });
  if (openedSettings) {
    ctx.setup.result.steps.push("Opened ChatGPT settings.");
    await ctx.setup.page.waitForTimeout(1_000);
  } else {
    ctx.setup.result.warnings.push("Could not find Settings in the account menu.");
  }
}
