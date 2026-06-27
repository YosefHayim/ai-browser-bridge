import type { Page } from "playwright";
import { SELECTORS } from "../selectors.config.ts";
import { submitPromptAttempt } from "./submit-prompt-attempt.ts";

/** Context for {@link runInjectPromptAttempts}. */
export interface RunInjectPromptAttemptsContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
  /** Prompt text to inject into the composer. */
  text: string;
}

/** Retry sending until the composer clears or attempts are exhausted. */
export async function runInjectPromptAttempts(ctx: RunInjectPromptAttemptsContext): Promise<void> {
  const input = ctx.page.locator(SELECTORS.promptInput).first();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await submitPromptAttempt({ page: ctx.page, input, text: ctx.text })) return;
  }
  throw new Error("injectPrompt: composer never cleared after 3 send attempts");
}
