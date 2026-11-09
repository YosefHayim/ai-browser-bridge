import type { Locator, Page } from "playwright";
import { PROVIDER_CONFIG } from "@/config.ts";
import type { BrowserProvider, ResponseWaitOptions } from "../browserProvider.ts";
import type { ModelOption } from "../connectors/connectorTypes.ts";
import { GuestSessionError } from "../providerErrors.ts";
import { isResponseGenerating, waitForResponseIdle } from "../streaming/streamingGuard.ts";

type ParsedWaitOptions = {
  timeout: number;
  previousAssistantCount?: number;
  previousLastAssistantText?: string;
};

// In-page DOM order of user + assistant turns. Selectors mirror SELECTORS below;
// keep this snippet in sync when Google changes Gemini's message tags.
const CAPTURE_ALL_MESSAGES_SNIPPET = `(() => {
  const messages = [];
  const userNodes = document.querySelectorAll("user-query, .query-text, .user-query, [data-message-author='user']");
  const assistantNodes = document.querySelectorAll("model-response, message-content, .model-response-text, .response-content");
  const turns = [];
  userNodes.forEach((node, index) => turns.push({ role: "user", node, index }));
  assistantNodes.forEach((node, index) => turns.push({ role: "assistant", node, index }));
  turns.sort((a, b) => {
    const position = a.node.compareDocumentPosition(b.node);
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return a.index - b.index;
  });
  for (const turn of turns) {
    const rawText = turn.node.innerText;
    if (typeof rawText !== "string") continue;
    const content = rawText.trim();
    if (content === "") continue;
    messages.push({ role: turn.role, content });
  }
  return messages;
})()`;

// DOM selectors for Gemini's web interface. Subject to change when Google updates UI.
export const SELECTORS = {
  promptInput: [
    "div.ql-editor",
    'rich-textarea [contenteditable="true"]',
    '[aria-label="Enter a prompt here"]',
    '[contenteditable="true"][role="textbox"]',
  ].join(", "),
  sendButton: [
    'button[aria-label="Send message"]',
    'button[aria-label*="Send" i]',
    ".send-button",
    "button.send-button",
  ].join(", "),
  responseBlock: PROVIDER_CONFIG.gemini.selectors.assistant,
  userBlock: ["user-query", ".query-text", ".user-query", '[data-message-author="user"]'].join(
    ", ",
  ),
  streamingIndicator: ['[aria-busy="true"]', 'button[aria-label*="Stop" i]'].join(", "),
  sidebarConversation: ['a[href*="/app/"]', 'nav a[href*="gemini.google.com"]'].join(", "),
  modelTrigger: [
    'button[aria-label*="model" i]',
    'button[aria-label*="Model" i]',
    '[data-test-id="model-selector"]',
    'button:has-text("Gemini")',
    'button:has-text("Flash")',
    'button:has-text("Pro")',
  ].join(", "),
  openMenu: '[role="menu"], [role="listbox"], mat-menu-panel',
  signInButton: [
    'a[href*="accounts.google.com"]',
    'button:has-text("Sign in")',
    '[aria-label*="Sign in" i]',
  ].join(", "),
  attachmentInput: 'input[type="file"]',
  attachmentButton: [
    'button[aria-label*="Upload" i]',
    'button[aria-label*="Attach" i]',
    'button[aria-label*="Add file" i]',
  ].join(", "),
  actionButtons: [
    'button[aria-label="Redo"]',
    'button[aria-label="Copy"]',
    'button[aria-label="Show more options"]',
  ].join(", "),
} as const;

/** Quiet window a plain text turn must hold before it counts as settled. */
const SETTLE_QUIET_MS = 1_500;

const normalizeDisplayText = (displayText: string): string => {
  return displayText
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const stripGeminiResponseHeading = (text: string): string => {
  return text.replace(/^Gemini said\s*/i, "").trim();
};

const captureLastResponse = async (page: Page): Promise<string> => {
  const blocks = page.locator(SELECTORS.responseBlock);
  const count = await blocks.count();
  if (count === 0) return "";
  const lastResponse = blocks.nth(count - 1);
  const responseText = await lastResponse.innerText().catch(() => "");
  const normalizedText = normalizeDisplayText(responseText);
  return stripGeminiResponseHeading(normalizedText);
};

const countAssistantResponses = async (page: Page): Promise<number> => {
  return page.locator(SELECTORS.responseBlock).count();
};

const captureAllMessages = async (
  page: Page,
): Promise<Array<{ role: string; content: string }>> => {
  return page.evaluate(CAPTURE_ALL_MESSAGES_SNIPPET);
};

// Gemini web does not expose ChatGPT-style prompt rewind; fail clearly.
const rewindLastUserPrompt = async (_page: Page, _replacement?: string): Promise<void> => {
  throw new Error("Rewind is not supported on gemini.google.com yet.");
};

const stopGenerating = async (page: Page, timeout = 5_000): Promise<boolean> => {
  const stopButton = page.locator('button[aria-label*="Stop" i]').first();
  if (!(await stopButton.isVisible({ timeout: 1_000 }).catch(() => false))) return false;
  await stopButton.click({ timeout });
  return true;
};

const attachFilesToPrompt = async (page: Page, attachmentPaths: string[]): Promise<void> => {
  if (attachmentPaths.length === 0) return;
  const directInput = page.locator(SELECTORS.attachmentInput).first();
  const inputCount = await directInput.count();
  if (inputCount > 0) {
    await directInput.setInputFiles(attachmentPaths);
    return;
  }

  const attachButton = page.locator(SELECTORS.attachmentButton).first();
  const buttonVisible = await attachButton.isVisible({ timeout: 2_000 }).catch(() => false);
  if (!buttonVisible) {
    throw new Error("Gemini file attachment controls are not available on this page.");
  }
  await attachButton.click();
  const fileInput = page.locator(SELECTORS.attachmentInput).first();
  await fileInput.waitFor({ state: "attached", timeout: 5_000 });
  await fileInput.setInputFiles(attachmentPaths);
};

export const isLikelyModelLabel = (label: string): boolean => {
  return /\b(gemini|flash|pro|thinking|advanced|experimental)\b/i.test(label);
};

const readModelFromTrigger = async (trigger: Locator): Promise<string> => {
  const triggerText = await trigger.innerText().catch(() => "");
  const text = normalizeDisplayText(triggerText);
  const line = text.split("\n").find((part) => isLikelyModelLabel(part));
  if (line !== undefined) return line;
  return readTriggerAriaLabel(trigger);
};

const readTriggerAriaLabel = async (trigger: Locator): Promise<string> => {
  const ariaLabel = await trigger.getAttribute("aria-label").catch(() => null);
  if (ariaLabel !== null && isLikelyModelLabel(ariaLabel)) return ariaLabel.trim();
  return "Gemini";
};

const collectMenuModels = async (page: Page): Promise<ModelOption[]> => {
  const items = page.locator(
    `${SELECTORS.openMenu} [role="menuitem"], ${SELECTORS.openMenu} [role="option"]`,
  );
  const count = await items.count();
  const models: ModelOption[] = [];
  for (let index = 0; index < count; index += 1) {
    const model = await readMenuItemModel(items.nth(index));
    if (model !== undefined) models.push(model);
  }
  return models;
};

const readMenuItemModel = async (item: Locator): Promise<ModelOption | undefined> => {
  const itemText = await item.innerText().catch(() => "");
  const label = normalizeDisplayText(itemText);
  if (label === "" || !isLikelyModelLabel(label)) return undefined;
  const selected =
    (await item.getAttribute("aria-checked").catch(() => null)) === "true" ||
    (await item.getAttribute("aria-selected").catch(() => null)) === "true";
  return { id: label.toLowerCase().replace(/\s+/g, "-"), label, selected };
};

const firstVisible = async (input: {
  page: Page;
  selector: string;
}): Promise<Locator | undefined> => {
  const locator = input.page.locator(input.selector);
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible().catch(() => false)) return candidate;
  }
  return undefined;
};

const detectCurrentModel = async (page: Page): Promise<string> => {
  try {
    const trigger = await firstVisible({ page, selector: SELECTORS.modelTrigger });
    if (trigger === undefined) return "Gemini";
    return await readModelFromTrigger(trigger);
  } catch {
    return "Gemini";
  }
};

const listAvailableModels = async (page: Page): Promise<ModelOption[]> => {
  const trigger = await firstVisible({ page, selector: SELECTORS.modelTrigger });
  if (trigger === undefined) return [];
  await trigger.click().catch(() => undefined);
  await page.waitForSelector(SELECTORS.openMenu, { timeout: 3_000 }).catch(() => undefined);
  const availableModels = await collectMenuModels(page);
  await page.keyboard.press("Escape").catch(() => undefined);
  return availableModels;
};

const selectModel = async (page: Page, query: string): Promise<string> => {
  const availableModels = await listAvailableModels(page);
  const labelQuery = query.trim().toLowerCase();
  const modelIdQuery = labelQuery.replace(/\s+/g, "-");
  const selectedModel = availableModels.find((model) => {
    const modelLabel = model.label.toLowerCase();
    return modelLabel.includes(labelQuery) || model.id.includes(modelIdQuery);
  });
  if (selectedModel === undefined) throw new Error(`Model not found in Gemini picker: ${query}`);

  const trigger = await firstVisible({ page, selector: SELECTORS.modelTrigger });
  if (trigger === undefined) throw new Error("Gemini model picker is not available.");
  await trigger.click();
  await page.waitForSelector(SELECTORS.openMenu, { timeout: 3_000 });
  const modelItems = page.locator(
    `${SELECTORS.openMenu} [role="menuitem"], ${SELECTORS.openMenu} [role="option"]`,
  );
  const matchingItem = modelItems.filter({ hasText: selectedModel.label }).first();
  await matchingItem.click();
  await page.keyboard.press("Escape").catch(() => undefined);
  return selectedModel.label;
};

const isGuestSession = async (page: Page): Promise<boolean> => {
  const composer = page.locator(SELECTORS.promptInput).first();
  if (await composer.isVisible({ timeout: 2500 }).catch(() => false)) return false;
  const signIn = page.locator(SELECTORS.signInButton).first();
  return signIn.isVisible({ timeout: 1500 }).catch(() => true);
};

const assertSignedIn = async (page: Page): Promise<void> => {
  if (await isGuestSession(page)) {
    throw new GuestSessionError({
      providerId: "gemini",
      reason:
        "Run `bridge chrome start --provider gemini`, click Sign in if needed, complete Google sign-in, leave Chrome open, then run again.",
    });
  }
};

const readSidebarConversations = async (
  page: Page,
): Promise<Array<{ id: string; title: string; url: string }>> => {
  const links = await page.locator(SELECTORS.sidebarConversation).all();
  const conversations: Array<{ id: string; title: string; url: string }> = [];
  for (const link of links) {
    const href = await link.getAttribute("href");
    const linkText = await link.innerText().catch(() => "");
    const title = normalizeDisplayText(linkText);
    if (href === null || href === "" || title === "") continue;
    conversations.push(conversationEntry({ href, title }));
  }
  return conversations;
};

const navigateToConversation = async (page: Page, url: string): Promise<void> => {
  await page.goto(url);
  await page.waitForSelector(SELECTORS.promptInput, { timeout: 30_000 });
};

const newConversation = async (page: Page): Promise<void> => {
  await page.goto("https://gemini.google.com/app");
  await page.waitForSelector(SELECTORS.promptInput, { timeout: 30_000 });
};

const conversationEntry = (input: {
  href: string;
  title: string;
}): {
  id: string;
  title: string;
  url: string;
} => {
  const url = input.href.startsWith("http") ? input.href : `https://gemini.google.com${input.href}`;
  const pathSegment = input.href.split("/").filter(Boolean).pop();
  const id = pathSegment === undefined ? input.href : pathSegment;
  return { id, title: input.title, url };
};

export const injectPrompt = async (page: Page, text: string): Promise<void> => {
  await page.bringToFront().catch(() => undefined);
  const composer = page.locator(SELECTORS.promptInput).first();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // Wait out any in-flight response before typing so a retry never sends on top of one.
    await waitForResponseIdle(page, SELECTORS.streamingIndicator);
    await composer.click();
    await composer.fill(text);
    await composer.dispatchEvent("input");
    await clickSendOrEnter(page);
    if (await composerClears(page)) return;
    if (await isResponseGenerating(page, SELECTORS.streamingIndicator)) return;
  }
  throw new Error("injectPrompt: composer never cleared after 3 send attempts");
};

const clickSendOrEnter = async (page: Page): Promise<void> => {
  const sendButton = page.locator(SELECTORS.sendButton).first();
  try {
    await sendButton.waitFor({ state: "visible", timeout: 5_000 });
    await sendButton.click();
    return;
  } catch {
    // Send button never surfaced; fall through to the Enter fallback unless a reply streams.
  }
  // Pressing Enter mid-stream would either no-op or interrupt Gemini's reply — hold until idle.
  if (await isResponseGenerating(page, SELECTORS.streamingIndicator)) return;
  await page.keyboard.press("Enter");
};

const composerClears = async (page: Page): Promise<boolean> => {
  for (let poll = 0; poll < 10; poll += 1) {
    if ((await readComposerText(page)) === "") return true;
    await page.waitForTimeout(500);
  }
  return false;
};

const readComposerText = async (page: Page): Promise<string> => {
  return page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(
      "div.ql-editor, [contenteditable='true'][role='textbox']",
    );
    if (editor === null) return "";
    return editor.innerText.trim();
  });
};

const parseWaitOptions = (
  waitOptions:
    | number
    | {
        timeout?: number;
        previousAssistantCount?: number;
        previousLastAssistantText?: string;
      },
): ParsedWaitOptions => {
  if (typeof waitOptions === "number") return { timeout: waitOptions };

  const timeout = waitOptions.timeout === undefined ? 300_000 : waitOptions.timeout;
  const previousLastAssistantText =
    waitOptions.previousLastAssistantText === undefined
      ? ""
      : waitOptions.previousLastAssistantText;

  return {
    timeout,
    previousAssistantCount: waitOptions.previousAssistantCount,
    previousLastAssistantText: normalizeDisplayText(previousLastAssistantText),
  };
};

const remainingTimeout = (startedAt: number, timeout: number): number => {
  const elapsedMs = Date.now() - startedAt;
  const remainingMs = timeout - elapsedMs;
  return Math.max(1_000, remainingMs);
};

const isTransientAssistantText = (text: string): boolean => {
  const normalized = text.trim().toLowerCase();
  return (
    normalized === "thinking" ||
    normalized.endsWith(" thinking") ||
    normalized.endsWith(" thinking...") ||
    /^thinking[.\s]*$/.test(normalized)
  );
};

const waitForResponseAfterBaseline = async (
  page: Page,
  options: ParsedWaitOptions,
): Promise<void> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < options.timeout) {
    if (await baselineAdvanced({ page, options })) return;
    await page.waitForTimeout(250);
  }
  throw new Error("Timed out waiting for Gemini to start a new response.");
};

const baselineAdvanced = async (request: {
  page: Page;
  options: ParsedWaitOptions;
}): Promise<boolean> => {
  const { page, options } = request;
  const streamingIndicator = page.locator(SELECTORS.streamingIndicator).first();
  const streaming = await streamingIndicator.isVisible().catch(() => false);
  if (streaming) return true;

  if (options.previousAssistantCount !== undefined) {
    const assistantCount = await countAssistantResponses(page);
    if (assistantCount > options.previousAssistantCount) return true;
  }

  const previousReply = options.previousLastAssistantText;
  if (previousReply === undefined || previousReply === "") return false;
  const capturedReply = await captureLastResponse(page).catch(() => "");
  const currentReply = normalizeDisplayText(capturedReply);
  if (currentReply === "") return false;
  return currentReply !== previousReply;
};

/**
 * Decide whether the current assistant turn has finished producing output.
 * Pure helper so completion policy is unit-testable without a browser.
 */
export const isTurnSettled = (state: {
  hasText: boolean;
  isTransientText: boolean;
  streaming: boolean;
  stableForMs: number;
}): boolean => {
  if (state.streaming) return false;
  if (state.stableForMs < SETTLE_QUIET_MS) return false;
  return state.hasText && !state.isTransientText;
};

const waitForResponse = async (
  page: Page,
  options: number | ResponseWaitOptions = {},
): Promise<void> => {
  const parsed = parseWaitOptions(options);
  const startedAt = Date.now();
  await waitForInitialResponse({ page, parsed });
  await waitForStreamingEnd({ page, startedAt, timeout: parsed.timeout });
  await waitForLastAssistantTextStable({
    page,
    timeout: remainingTimeout(startedAt, parsed.timeout),
  });
};

const waitForInitialResponse = async (input: {
  page: Page;
  parsed: ParsedWaitOptions;
}): Promise<void> => {
  if (
    input.parsed.previousAssistantCount !== undefined ||
    (input.parsed.previousLastAssistantText !== undefined &&
      input.parsed.previousLastAssistantText !== "")
  ) {
    await waitForResponseAfterBaseline(input.page, input.parsed);
    return;
  }
  await input.page.waitForSelector(SELECTORS.responseBlock, { timeout: input.parsed.timeout });
};

const waitForStreamingEnd = async (input: {
  page: Page;
  startedAt: number;
  timeout: number;
}): Promise<void> => {
  try {
    const indicator = input.page.locator(SELECTORS.streamingIndicator).first();
    await indicator.waitFor({ state: "visible", timeout: 10_000 });
    await indicator.waitFor({
      state: "hidden",
      timeout: remainingTimeout(input.startedAt, input.timeout),
    });
  } catch {
    // Response might already be complete
  }
};

const waitForLastAssistantTextStable = async (input: {
  page: Page;
  timeout: number;
}): Promise<void> => {
  const startedAt = Date.now();
  let lastText = "";
  let stableSince = Date.now();
  while (Date.now() - startedAt < input.timeout) {
    const snapshot = await readStabilitySnapshot(input.page);
    if (snapshot.text !== lastText) {
      lastText = snapshot.text;
      stableSince = Date.now();
    }
    if (
      isTurnSettled({
        hasText: snapshot.text !== "",
        isTransientText: isTransientAssistantText(snapshot.text),
        streaming: snapshot.streaming,
        stableForMs: Date.now() - stableSince,
      })
    ) {
      return;
    }
    await input.page.waitForTimeout(500);
  }
  throw new Error("Timed out waiting for Gemini response to settle.");
};

const readStabilitySnapshot = async (page: Page): Promise<{ text: string; streaming: boolean }> => {
  const capturedText = await captureLastResponse(page).catch(() => "");
  const text = normalizeDisplayText(capturedText);
  const streaming = await page
    .locator(SELECTORS.streamingIndicator)
    .first()
    .isVisible()
    .catch(() => false);
  return { text, streaming };
};

export const geminiProvider = {
  id: "gemini",
  origin: "gemini.google.com",
  defaultUrl: "https://gemini.google.com/app",
  defaultModel: "Gemini",
  displayName: "Gemini",
  composerSelector: PROVIDER_CONFIG.gemini.selectors.composer,
  supportsMcpConnector: false,
  assertSignedIn,
  injectPrompt,
  waitForResponse,
  captureLastResponse,
  countAssistantResponses,
  captureAllMessages,
  readSidebarConversations,
  navigateToConversation,
  newConversation,
  detectCurrentModel,
  listAvailableModels,
  selectModel,
  rewindLastUserPrompt,
  stopGenerating,
  attachFilesToPrompt,
  isLikelyModelLabel,
} satisfies BrowserProvider;
