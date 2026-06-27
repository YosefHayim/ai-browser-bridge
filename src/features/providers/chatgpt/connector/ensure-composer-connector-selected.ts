import type { ConnectorSetupContext } from "./connector.types.ts";
import {
  isConnectorSelectedInComposer,
  removeStaleBridgeConnectorPills,
} from "./connector-composer-helpers.ts";
import { openComposerConnectorMenu } from "./open-composer-connector-menu.ts";

/** Ensure the desired connector is selected in the composer, opening the menu if needed. */
export async function ensureComposerConnectorSelected(ctx: ConnectorSetupContext): Promise<boolean> {
  if (await isConnectorSelectedInComposer({ setup: ctx })) return true;
  await removeStaleBridgeConnectorPills(ctx);
  if (await isConnectorSelectedInComposer({ setup: ctx })) return true;
  return openComposerConnectorMenu(ctx);
}
