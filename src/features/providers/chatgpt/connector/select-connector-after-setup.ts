import type { ConnectorSetupContext } from "./connector.types.ts";
import { selectConnectorInComposer } from "./select-connector-in-composer.ts";

/** Select the connector in the composer after settings setup completes. */
export async function selectConnectorAfterSetup(ctx: ConnectorSetupContext): Promise<void> {
  const selectedInComposer = await selectConnectorInComposer(ctx);
  if (selectedInComposer) {
    ctx.result.steps.push("Selected the connector in the composer.");
  } else {
    ctx.result.warnings.push("Connector is configured, but the composer menu did not expose it for automatic selection.");
  }
}
