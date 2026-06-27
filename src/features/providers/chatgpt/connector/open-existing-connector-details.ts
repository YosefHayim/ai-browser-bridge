import type { ConnectorSetupContext, ExistingConnectorState } from "./connector.types.ts";
import { openConnectorDetailsPanel } from "./open-connector-details-panel.ts";
import { readOpenConnectorState } from "./read-open-connector-state.ts";

/** Context for {@link readConnectorState}. */
export interface ReadConnectorStateContext {
  /** Connector setup context with page and connector identifiers. */
  setup: ConnectorSetupContext;
}

/** Read the current open connector state for the desired connector. */
export function readConnectorState(ctx: ReadConnectorStateContext) {
  return readOpenConnectorState({
    page: ctx.setup.page,
    connectorName: ctx.setup.connectorName,
    connectorUrl: ctx.setup.connectorUrl,
  });
}

/** Open an existing connector's detail panel and classify its URL state. */
export async function openExistingConnectorDetails(ctx: ConnectorSetupContext): Promise<ExistingConnectorState> {
  const alreadyOpen = await readConnectorState({ setup: ctx });
  if (alreadyOpen !== "missing") return alreadyOpen;
  if (!await openConnectorDetailsPanel({ setup: ctx })) return "missing";
  return readConnectorState({ setup: ctx });
}
