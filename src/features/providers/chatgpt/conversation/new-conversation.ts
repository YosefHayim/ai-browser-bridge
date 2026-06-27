import type { Page } from "playwright";

/** Start a new ChatGPT conversation. */
export async function newConversation(page: Page): Promise<void> {
  await page.goto("https://chatgpt.com/");
  await page.waitForSelector("#prompt-textarea, [contenteditable]", { timeout: 30_000 });
}
