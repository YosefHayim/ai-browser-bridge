import type { Page } from "playwright";
import { normalizeDisplayText } from "../dom/normalize-display-text.ts";

/** Context for {@link settingsDialogText}. */
export interface SettingsDialogTextContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/** Read normalized text from the last open settings dialog. */
export async function settingsDialogText(ctx: SettingsDialogTextContext): Promise<string> {
  return normalizeDisplayText({
    value: await ctx.page.locator('[role="dialog"]').last().innerText().catch(() => ""),
  });
}
