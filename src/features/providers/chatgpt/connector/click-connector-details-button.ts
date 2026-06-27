import type { Locator } from "playwright";
import type { ConnectorSetupContext } from "./connector.types.ts";

/** Context for {@link clickConnectorDetailsButton}. */
export interface ClickConnectorDetailsButtonContext {
  /** Connector list button locator. */
  button: Locator;
  /** Connector setup context with page and result accumulator. */
  setup: ConnectorSetupContext;
}

/** Click a connector list button and record the opened step. */
export async function clickConnectorDetailsButton(ctx: ClickConnectorDetailsButtonContext): Promise<void> {
  await ctx.button.click({ timeout: 3_000, force: true });
  await ctx.setup.page.waitForTimeout(1_000);
  ctx.setup.result.steps.push(`Opened existing connector: ${ctx.setup.connectorName}.`);
}
