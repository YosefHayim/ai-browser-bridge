import type { ConnectorSetupContext } from "./connector.types.ts";
import { cleanupDuplicateConnectorApps } from "./cleanup-duplicate-connector-apps.ts";
import { createNewConnector } from "./create-new-connector.ts";
import { handleStaleExistingConnector } from "./handle-stale-existing-connector.ts";
import { openAppsOrConnectorsPanel } from "./open-apps-or-connectors-panel.ts";
import { openChatGptSettings } from "./open-chatgpt-settings.ts";
import { tryFinalizeExistingConnector } from "./try-finalize-existing-connector.ts";

/** Context for {@link runConnectorSetupSteps}. */
export interface RunConnectorSetupStepsContext {
  /** Connector setup context with page and result accumulator. */
  setup: ConnectorSetupContext;
  /** Whether duplicate cleanup already found the current connector. */
  hasCurrentConnector: boolean;
}

/** Run post-settings connector setup steps after the settings panels are open. */
export async function runConnectorSetupSteps(ctx: RunConnectorSetupStepsContext): Promise<ConnectorSetupContext["result"]> {
  if (await tryFinalizeExistingConnector({ setup: ctx.setup, hasCurrentConnector: ctx.hasCurrentConnector })) {
    return ctx.setup.result;
  }
  if (!await handleStaleExistingConnector(ctx.setup)) return ctx.setup.result;
  await createNewConnector(ctx.setup);
  return ctx.setup.result;
}

/** Run the full ChatGPT connector setup workflow. */
export async function executeConnectorSetup(ctx: ConnectorSetupContext): Promise<ConnectorSetupContext["result"]> {
  await openChatGptSettings(ctx);
  await openAppsOrConnectorsPanel(ctx);
  const hasCurrentConnector = await cleanupDuplicateConnectorApps(ctx);
  return runConnectorSetupSteps({ setup: ctx, hasCurrentConnector });
}
