import { firstVisible } from "../dom/first-visible.ts";
import type { ConnectorSetupContext } from "./connector.types.ts";

/** Close the settings dialog when a close button is visible. */
export async function closeSettingsDialogIfPresent(ctx: ConnectorSetupContext): Promise<void> {
  const closeButton = await firstVisible({
    page: ctx.page,
    selectors: [
      '[role="dialog"] button[aria-label="Close"]',
      '[role="dialog"] [data-testid="close-button"]',
    ],
  });
  if (closeButton) {
    await closeButton.click({ timeout: 2_000, force: true }).catch(() => {});
    await ctx.page.waitForTimeout(500);
  }
}
