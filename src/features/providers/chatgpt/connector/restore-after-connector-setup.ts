import type { ConnectorSetupContext } from "./connector.types.ts";
import { closeSettingsDialogIfPresent } from "./close-settings-dialog.ts";
import { restoreReturnUrlIfNeeded } from "./restore-return-url.ts";

/** Close settings and restore the pre-setup URL after a failed automatic setup. */
export async function restoreAfterConnectorSetup(ctx: ConnectorSetupContext): Promise<void> {
  await closeSettingsDialogIfPresent(ctx);
  await restoreReturnUrlIfNeeded(ctx);
}
