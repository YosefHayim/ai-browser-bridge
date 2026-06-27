import { SELECTORS } from "../selectors.config.ts";
import { clickFirstVisible } from "../dom/click-first-visible.ts";
import type { ConnectorSetupContext } from "./connector.types.ts";
import { clickSettingsEntry } from "./click-settings-entry.ts";

/** Open ChatGPT settings through the account menu when the deep link fails. */
export async function openSettingsFromAccountMenu(ctx: ConnectorSetupContext): Promise<void> {
  await ctx.page.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded" }).catch(() => {});
  await ctx.page.waitForSelector(SELECTORS.promptInput, { timeout: 15_000 }).catch(() => {});
  if (!await clickFirstVisible({ page: ctx.page, selectors: SELECTORS.accountMenuButton, timeout: 2_000 })) {
    ctx.result.warnings.push("Could not find the ChatGPT profile/account menu.");
    return;
  }
  ctx.result.steps.push("Opened ChatGPT account menu.");
  await clickSettingsEntry({ setup: ctx });
}
