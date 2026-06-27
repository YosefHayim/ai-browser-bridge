import type { Page } from "playwright";

/** Navigate to a specific conversation by URL. */
export async function navigateToConversation(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForSelector("#prompt-textarea, [contenteditable]", { timeout: 30_000 });
}
