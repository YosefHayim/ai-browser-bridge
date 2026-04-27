import type { Page } from "playwright";

/** DOM selectors for ChatGPT's interface. Subject to change if ChatGPT updates UI. */
const SELECTORS = {
  /** The contenteditable prompt input field. */
  promptInput: '#prompt-textarea, [contenteditable="true"]',
  /** The send button (visible when text is entered). */
  sendButton: 'button[data-testid="send-button"], button[aria-label="Send prompt"]',
  /** Individual assistant response blocks. */
  responseBlock: '[data-message-author-role="assistant"]',
  /** The most recent response block. */
  lastResponse: '[data-message-author-role="assistant"]:last-of-type',
  /** Sidebar conversation links. */
  sidebarConversation: 'nav a[href^="/c/"]',
  /** Streaming indicator (the stop button appears while streaming). */
  streamingIndicator: 'button[aria-label="Stop generating"]',
} as const;

/** Type a prompt into ChatGPT's input field and send it. */
export async function injectPrompt(page: Page, text: string): Promise<void> {
  const input = page.locator(SELECTORS.promptInput).first();
  await input.click();
  await input.pressSequentially(text, { delay: 30 });
  await input.dispatchEvent("input");

  const sendBtn = page.locator(SELECTORS.sendButton).first();
  await sendBtn.waitFor({ state: "visible", timeout: 5_000 });
  await sendBtn.click();
}

/** Wait for ChatGPT to finish streaming its response. */
export async function waitForResponse(page: Page, timeout = 120_000): Promise<void> {
  // Wait for streaming to start, then for it to stop
  try {
    await page.locator(SELECTORS.streamingIndicator).waitFor({ state: "visible", timeout: 10_000 });
  } catch {
    // Response might already be complete
  }

  await page.locator(SELECTORS.streamingIndicator).waitFor({ state: "hidden", timeout });
}

/** Extract the text content of the last assistant response. */
export async function captureLastResponse(page: Page): Promise<string> {
  const last = page.locator(SELECTORS.lastResponse).first();
  return last.innerText();
}

/** Extract all messages from the current conversation in DOM order. */
export async function captureAllMessages(page: Page): Promise<Array<{ role: string; content: string }>> {
  const messages: Array<{ role: string; content: string }> = [];

  const allBlocks = await page.locator("[data-message-author-role]").all();
  for (const block of allBlocks) {
    const role = await block.getAttribute("data-message-author-role") ?? "unknown";
    messages.push({ role, content: await block.innerText() });
  }

  return messages;
}

/** Read the conversation list from the sidebar. */
export async function readSidebarConversations(page: Page): Promise<Array<{ id: string; title: string; url: string }>> {
  const links = await page.locator(SELECTORS.sidebarConversation).all();

  const conversations: Array<{ id: string; title: string; url: string }> = [];
  for (const link of links) {
    const href = await link.getAttribute("href");
    const title = await link.innerText();
    if (href && title) {
      const id = href.split("/").pop() ?? "";
      conversations.push({ id, title: title.trim(), url: `https://chatgpt.com${href}` });
    }
  }

  return conversations;
}

/** Navigate to a specific conversation by URL. */
export async function navigateToConversation(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
}

export { SELECTORS };
