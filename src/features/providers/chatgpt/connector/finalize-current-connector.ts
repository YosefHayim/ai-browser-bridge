import type { ConnectorSetupContext } from "./connector.types.ts";
import { refreshOpenConnectorIfPresent } from "./refresh-open-connector.ts";
import { selectConnectorAfterSetup } from "./select-connector-after-setup.ts";

/** Finalize setup when an existing connector already uses the current URL. */
export async function finalizeCurrentConnector(ctx: ConnectorSetupContext): Promise<void> {
  ctx.result.completed = true;
  ctx.result.steps.push("Existing connector already uses the current URL.");
  if (await refreshOpenConnectorIfPresent(ctx)) {
    ctx.result.steps.push("Refreshed the connector tool schema.");
  }
  await selectConnectorAfterSetup(ctx);
}
