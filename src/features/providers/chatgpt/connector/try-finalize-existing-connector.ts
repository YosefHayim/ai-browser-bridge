import type { ConnectorSetupContext } from "./connector.types.ts";
import { openExistingConnectorDetails } from "./open-existing-connector-details.ts";
import { finalizeCurrentConnector } from "./finalize-current-connector.ts";

/** Context for {@link finalizeIfCurrentConnector}. */
export interface FinalizeIfCurrentConnectorContext {
  /** Connector setup context with page and result accumulator. */
  setup: ConnectorSetupContext;
}

/** Open existing connector details and finalize when the URL already matches. */
export async function finalizeIfCurrentConnector(ctx: FinalizeIfCurrentConnectorContext): Promise<boolean> {
  const existing = await openExistingConnectorDetails(ctx.setup);
  if (existing !== "current") return false;
  await finalizeCurrentConnector(ctx.setup);
  return true;
}

/** Context for {@link tryFinalizeExistingConnector}. */
export interface TryFinalizeExistingConnectorContext {
  /** Connector setup context with page and result accumulator. */
  setup: ConnectorSetupContext;
  /** Whether duplicate cleanup already found the current connector. */
  hasCurrentConnector: boolean;
}

/** Attempt to finalize when an existing connector already matches the desired URL. */
export async function tryFinalizeExistingConnector(ctx: TryFinalizeExistingConnectorContext): Promise<boolean> {
  if (ctx.hasCurrentConnector && await finalizeIfCurrentConnector({ setup: ctx.setup })) return true;
  return finalizeIfCurrentConnector({ setup: ctx.setup });
}
