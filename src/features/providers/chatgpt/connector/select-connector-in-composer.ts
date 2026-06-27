import type { ConnectorSetupContext } from "./connector.types.ts";
import { closeSettingsDialogIfPresent } from "./close-settings-dialog.ts";
import { restoreReturnUrlIfNeeded } from "./restore-return-url.ts";
import { ensureComposerConnectorSelected } from "./ensure-composer-connector-selected.ts";

/** Select the configured connector in the ChatGPT composer plus-menu. */
export async function selectConnectorInComposer(ctx: ConnectorSetupContext): Promise<boolean> {
  await closeSettingsDialogIfPresent(ctx);
  await restoreReturnUrlIfNeeded(ctx);
  await ctx.page.keyboard.press("Escape").catch(() => {});
  return ensureComposerConnectorSelected(ctx);
}
