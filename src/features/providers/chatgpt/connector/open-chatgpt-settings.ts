import type { ConnectorSetupContext } from "./connector.types.ts";
import { openSettingsFromAccountMenu } from "./open-settings-from-account-menu.ts";

/** Open ChatGPT settings, preferring the Connectors deep link. */
export async function openChatGptSettings(ctx: ConnectorSetupContext): Promise<void> {
  await ctx.page.goto("https://chatgpt.com/#settings/Connectors", { waitUntil: "domcontentloaded" }).catch(() => {});
  await ctx.page.waitForTimeout(1_500);
  const settingsDialogOpen = await ctx.page.locator('[role="dialog"]:has-text("Apps"), [role="dialog"]:has-text("Connectors")').first()
    .isVisible()
    .catch(() => false);
  if (settingsDialogOpen) {
    ctx.result.steps.push("Opened ChatGPT settings.");
    return;
  }
  await openSettingsFromAccountMenu(ctx);
}
