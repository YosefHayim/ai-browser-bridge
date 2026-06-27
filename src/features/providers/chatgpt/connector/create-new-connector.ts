import type { ConnectorSetupContext } from "./connector.types.ts";
import { enableDeveloperModeIfPresent } from "./enable-developer-mode.ts";
import { fillConnectorFormFields } from "./fill-connector-form-fields.ts";
import { finishConnectorCreation } from "./finish-connector-creation.ts";
import { openAdvancedSettingsIfPresent } from "./open-advanced-settings.ts";
import { openCreateConnectorForm } from "./open-create-connector-form.ts";
import { restoreAfterConnectorSetup } from "./restore-after-connector-setup.ts";

/** Context for {@link warnMissingConnectorUrlField}. */
export interface WarnMissingConnectorUrlFieldContext {
  /** Connector setup context with page and result accumulator. */
  setup: ConnectorSetupContext;
}

/** Record a warning and optionally restore the page when the URL field is missing. */
export async function warnMissingConnectorUrlField(ctx: WarnMissingConnectorUrlFieldContext): Promise<void> {
  ctx.setup.result.warnings.push("Could not find the connector URL field. The settings UI is open; paste the Connector URL manually.");
  if (ctx.setup.options.automatic) await restoreAfterConnectorSetup(ctx.setup);
}

/** Create a new connector through the settings UI form. */
export async function createNewConnector(ctx: ConnectorSetupContext): Promise<void> {
  await openAdvancedSettingsIfPresent(ctx);
  await enableDeveloperModeIfPresent(ctx);
  await openCreateConnectorForm(ctx);
  if (!await fillConnectorFormFields(ctx)) {
    await warnMissingConnectorUrlField({ setup: ctx });
    return;
  }
  await finishConnectorCreation({ setup: ctx });
}
