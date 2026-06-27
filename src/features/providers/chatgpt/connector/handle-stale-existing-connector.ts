import type { ConnectorSetupContext } from "./connector.types.ts";
import { deleteOpenConnectorIfPresent } from "./delete-open-connector.ts";
import { openAdvancedSettingsIfPresent } from "./open-advanced-settings.ts";
import { openAppsOrConnectorsPanel } from "./open-apps-or-connectors-panel.ts";
import { openExistingConnectorDetails } from "./open-existing-connector-details.ts";
import { restoreAfterConnectorSetup } from "./restore-after-connector-setup.ts";
import { returnToConnectorListIfNeeded } from "./return-to-connector-list.ts";

/** Handle stale or unknown existing connectors before creating a new one. */
export async function handleStaleExistingConnector(ctx: ConnectorSetupContext): Promise<boolean> {
  const existing = await openExistingConnectorDetails(ctx);
  if (existing === "stale") return deleteStaleConnector(ctx);
  if (existing === "unknown") {
    ctx.result.warnings.push("Existing connector was found, but its URL could not be read from the settings panel.");
  }
  return true;
}

/** Delete a stale connector and reopen the connectors panel for recreation. */
async function deleteStaleConnector(ctx: ConnectorSetupContext): Promise<boolean> {
  if (await deleteOpenConnectorIfPresent({ page: ctx.page })) {
    ctx.result.steps.push("Deleted stale connector app before recreating it with the new tunnel URL.");
    await returnToConnectorListIfNeeded(ctx);
    await openAppsOrConnectorsPanel(ctx);
    await openAdvancedSettingsIfPresent(ctx);
    return true;
  }
  ctx.result.warnings.push("Existing connector uses an old tunnel URL, but ChatGPT did not expose a delete/update control.");
  if (ctx.options.automatic) await restoreAfterConnectorSetup(ctx);
  return false;
}
