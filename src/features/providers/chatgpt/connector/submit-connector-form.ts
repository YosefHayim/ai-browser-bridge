import { clickFirstVisible } from "../dom/click-first-visible.ts";
import { waitForConnectorButton } from "./find-connector-button.ts";
import type { ConnectorSetupContext } from "./connector.types.ts";
import { selectConnectorAfterSetup } from "./select-connector-after-setup.ts";

/** Context for {@link connectorFormStillOpen}. */
export interface ConnectorFormStillOpenContext {
  /** Connector setup context with page handle. */
  setup: ConnectorSetupContext;
}

/** True when the connector URL field is still visible after submit. */
export async function connectorFormStillOpen(ctx: ConnectorFormStillOpenContext): Promise<boolean> {
  return ctx.setup.page.locator('input[name="custom-connector-url"], #custom-connector-url').first()
    .isVisible()
    .catch(() => false);
}

/** Context for {@link markConnectorSubmitCompleted}. */
export interface MarkConnectorSubmitCompletedContext {
  /** Connector setup context with page and result accumulator. */
  setup: ConnectorSetupContext;
}

/** Mark connector setup complete and select the connector in the composer. */
export async function markConnectorSubmitCompleted(ctx: MarkConnectorSubmitCompletedContext): Promise<void> {
  ctx.setup.result.completed = true;
  ctx.setup.result.steps.push("Submitted the connector form.");
  await selectConnectorAfterSetup(ctx.setup);
}

/** Context for {@link warnConnectorSubmitIncomplete}. */
export interface WarnConnectorSubmitIncompleteContext {
  /** Connector setup context with page and result accumulator. */
  setup: ConnectorSetupContext;
}

/** Warn when the connector form remains open after submit. */
export async function warnConnectorSubmitIncomplete(ctx: WarnConnectorSubmitIncompleteContext): Promise<void> {
  const appVisible = await waitForConnectorButton({
    page: ctx.setup.page,
    connectorName: ctx.setup.connectorName,
    timeoutMs: 20_000,
  });
  const formStillOpen = await connectorFormStillOpen({ setup: ctx.setup });
  if (formStillOpen && !appVisible) {
    ctx.setup.result.warnings.push("Connector form is still open after submit. Check the visible validation message in ChatGPT settings.");
    return;
  }
  await markConnectorSubmitCompleted({ setup: ctx.setup });
}

/** Submit the connector creation form and finalize the setup result. */
export async function submitConnectorForm(ctx: ConnectorSetupContext): Promise<void> {
  const submitted = await clickFirstVisible({
    page: ctx.page,
    selectors: [
      'button:has-text("Create")',
      'button:has-text("Save")',
      'button:has-text("Add")',
      'button:has-text("Connect")',
    ],
    timeout: 2_000,
  });
  if (!submitted) {
    ctx.result.warnings.push("Connector form was filled, but no Create/Save/Add button was visible or enabled.");
    return;
  }
  await warnConnectorSubmitIncomplete({ setup: ctx });
}
