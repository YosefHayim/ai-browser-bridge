import type { Page } from "playwright";
import { SELECTORS } from "./selectors.config.ts";

/** Gemini web does not expose ChatGPT-style prompt rewind; fail clearly. */
export async function rewindLastUserPrompt(_page: Page, _replacement?: string): Promise<void> {
  throw new Error("Rewind is not supported on gemini.google.com yet.");
}

/** Stop the active Gemini response stream when possible. */
export async function stopGenerating(page: Page, timeout = 5_000): Promise<boolean> {
  const stop = page.locator('button[aria-label*="Stop" i]').first();
  if (!(await stop.isVisible({ timeout: 1_000 }).catch(() => false))) return false;
  await stop.click({ timeout });
  return true;
}

/** Attach local files to the Gemini composer when a file input is available. */
export async function attachFilesToPrompt(page: Page, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const directInput = page.locator(SELECTORS.attachmentInput).first();
  if (await directInput.count() > 0) {
    await directInput.setInputFiles(paths);
    return;
  }
  await attachViaButton({ page, paths });
}

async function attachViaButton(input: { page: Page; paths: string[] }): Promise<void> {
  const attachButton = input.page.locator(SELECTORS.attachmentButton).first();
  if (!(await attachButton.isVisible({ timeout: 2_000 }).catch(() => false))) {
    throw new Error("Gemini file attachment controls are not available on this page.");
  }
  await attachButton.click();
  await setAttachmentFiles(input);
}

async function setAttachmentFiles(input: { page: Page; paths: string[] }): Promise<void> {
  const fileInput = input.page.locator(SELECTORS.attachmentInput).first();
  await fileInput.waitFor({ state: "attached", timeout: 5_000 });
  await fileInput.setInputFiles(input.paths);
}
