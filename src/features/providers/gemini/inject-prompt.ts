import type { Locator, Page } from "playwright";
import { SELECTORS } from "./selectors.config.ts";

/** Type a prompt into Gemini's composer and confirm it was sent. */
export async function injectPrompt(page: Page, text: string): Promise<void> {
  await page.bringToFront().catch(() => {});
  const input = page.locator(SELECTORS.promptInput).first();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await fillAndSend({ page, input, text });
    if (await composerClears({ page })) return;
  }
  throw new Error("injectPrompt: composer never cleared after 3 send attempts");
}

async function fillAndSend(params: { page: Page; input: Locator; text: string }): Promise<void> {
  await params.input.click();
  await params.input.fill(params.text);
  await params.input.dispatchEvent("input");
  await clickSendOrEnter(params.page);
}

async function clickSendOrEnter(page: Page): Promise<void> {
  const sendBtn = page.locator(SELECTORS.sendButton).first();
  try {
    await sendBtn.waitFor({ state: "visible", timeout: 5_000 });
    await sendBtn.click();
  } catch {
    await page.keyboard.press("Enter");
  }
}

async function composerClears(params: { page: Page }): Promise<boolean> {
  for (let poll = 0; poll < 10; poll += 1) {
    if (await readComposerText(params.page) === "") return true;
    await params.page.waitForTimeout(500);
  }
  return false;
}

async function readComposerText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>("div.ql-editor, [contenteditable='true'][role='textbox']");
    return (editor?.innerText ?? "").trim();
  });
}
