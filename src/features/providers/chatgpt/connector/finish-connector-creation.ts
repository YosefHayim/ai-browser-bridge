import type { ConnectorSetupContext } from "./connector.types.ts";
import { acceptCustomMcpRiskIfPresent } from "./accept-custom-mcp-risk.ts";
import { restoreAfterConnectorSetup } from "./restore-after-connector-setup.ts";
import { selectNoAuthenticationIfPresent } from "./select-no-authentication.ts";
import { submitConnectorForm } from "./submit-connector-form.ts";

/** Context for {@link recordConnectorFormOptions}. */
export interface RecordConnectorFormOptionsContext {
  /** Connector setup context with page and result accumulator. */
  setup: ConnectorSetupContext;
}

/** Record optional auth and risk acceptance steps before submit. */
export async function recordConnectorFormOptions(ctx: RecordConnectorFormOptionsContext): Promise<void> {
  if (await selectNoAuthenticationIfPresent(ctx.setup)) {
    ctx.setup.result.steps.push("Selected no-authentication option when visible.");
  }
  if (await acceptCustomMcpRiskIfPresent(ctx.setup)) {
    ctx.setup.result.steps.push("Accepted custom MCP server risk notice.");
  }
}

/** Context for {@link finishConnectorCreation}. */
export interface FinishConnectorCreationContext {
  /** Connector setup context with page and result accumulator. */
  setup: ConnectorSetupContext;
}

/** Submit the connector form and restore the page on automatic failure. */
export async function finishConnectorCreation(ctx: FinishConnectorCreationContext): Promise<void> {
  await recordConnectorFormOptions({ setup: ctx.setup });
  await submitConnectorForm(ctx.setup);
  if (ctx.setup.options.automatic && !ctx.setup.result.completed) {
    await restoreAfterConnectorSetup(ctx.setup);
  }
}
