import type { Locator, Page } from "playwright";
import { clickSendButton } from "./click-send-button.ts";
import { composerClears } from "./composer-clears.ts";

/** Context for {@link submitPromptAttempt}. */
export interface SubmitPromptAttemptContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
  /** Composer input locator to fill before sending. */
  input: Locator;
  /** Prompt text to inject into the composer. */
  text: string;
}

/** Fill the composer and attempt one send; return true when the composer clears. */
export async function submitPromptAttempt(ctx: SubmitPromptAttemptContext): Promise<boolean> {
  await ctx.input.click();
  await ctx.input.fill(ctx.text);
  await ctx.input.dispatchEvent("input");
  await clickSendButton({ page: ctx.page });
  return composerClears({ page: ctx.page });
}
