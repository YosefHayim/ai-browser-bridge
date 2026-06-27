import type { Page } from "playwright";
import { SELECTORS } from "../selectors.config.ts";

/** Context for {@link clickSendButton}. */
export interface ClickSendButtonContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/** Click the send button or fall back to pressing Enter. */
export async function clickSendButton(ctx: ClickSendButtonContext): Promise<void> {
  const sendBtn = ctx.page.locator(SELECTORS.sendButton).first();
  try {
    await sendBtn.waitFor({ state: "visible", timeout: 5_000 });
    await sendBtn.click();
  } catch {
    await ctx.page.keyboard.press("Enter");
  }
}
