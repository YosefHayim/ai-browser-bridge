import type { ConnectorSetupContext } from "./connector.types.ts";
import { clickConnectorDetailsButton } from "./click-connector-details-button.ts";
import { findConnectorButton } from "./find-connector-button.ts";

/** Context for {@link openConnectorDetailsPanel}. */
export interface OpenConnectorDetailsPanelContext {
  /** Connector setup context with page and result accumulator. */
  setup: ConnectorSetupContext;
}

/** Click an existing connector in the list and open its detail panel. */
export async function openConnectorDetailsPanel(ctx: OpenConnectorDetailsPanelContext): Promise<boolean> {
  const button = await findConnectorButton({ page: ctx.setup.page, connectorName: ctx.setup.connectorName });
  if (!button) return false;
  await clickConnectorDetailsButton({ button, setup: ctx.setup });
  return true;
}
