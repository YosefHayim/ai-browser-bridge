import type { Page } from "playwright";
import { runInjectPromptAttempts } from "./run-inject-prompt-attempts.ts";

/**
 * Type a prompt into ChatGPT's input field, send it, and confirm it actually left
 * the composer before returning.
 */
export async function injectPrompt(page: Page, text: string): Promise<void> {
  await page.bringToFront().catch(() => {});
  await runInjectPromptAttempts({ page, text });
}
