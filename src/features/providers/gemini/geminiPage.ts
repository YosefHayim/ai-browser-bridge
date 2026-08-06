import type { Locator, Page } from "playwright";
import { PROVIDER_CONFIG } from "@/config";
import type { ModelOption } from "@/features/domain";
import type { BrowserProvider, ResponseWaitOptions } from "../browserProvider.ts";
import { GuestSessionError } from "../providerErrors.ts";
import { isResponseGenerating, waitForResponseIdle } from "../streamingGuard.ts";

// --- capture-response.dom-snippet.ts ---
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
    const content = turn.node.innerText?.trim() ?? "";
    if (content) messages.push({ role: turn.role, content });
  }
  return messages;
})()`;

// --- selectors.config.ts ---
/** DOM selectors for Gemini's web interface. Subject to change when Google updates UI. */
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

// --- wait-response.ts ---

/** Quiet window a plain text turn must hold before it counts as settled. */
const SETTLE_QUIET_MS = 1_500;

/** Normalize whitespace in display text scraped from the DOM. */
const normalizeDisplayText = (value: string): string => {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

// --- capture-response.ts ---

const stripGeminiResponseHeading = (text: string): string => {
  return text.replace(/^Gemini said\s*/i, "").trim();
};

/** Extract the text content of the last assistant response. */
const captureLastResponse = async (page: Page): Promise<string> => {
  const blocks = page.locator(SELECTORS.responseBlock);
  const count = await blocks.count();
  if (count === 0) return "";
  const text = normalizeDisplayText(
    await blocks
      .nth(count - 1)
      .innerText()
      .catch(() => ""),
  );
  return stripGeminiResponseHeading(text);
};

/** Count assistant responses currently rendered in the conversation. */
const countAssistantResponses = async (page: Page): Promise<number> => {
  return page.locator(SELECTORS.responseBlock).count();
};

/** Extract all messages from the current conversation in DOM order. */
const captureAllMessages = async (
  page: Page,
): Promise<Array<{ role: string; content: string }>> => {
  return page.evaluate(CAPTURE_ALL_MESSAGES_SNIPPET);
};

// --- gemini-actions.ts ---

/** Gemini web does not expose ChatGPT-style prompt rewind; fail clearly. */
const rewindLastUserPrompt = async (_page: Page, _replacement?: string): Promise<void> => {
  throw new Error("Rewind is not supported on gemini.google.com yet.");
};

/** Stop the active Gemini response stream when possible. */
const stopGenerating = async (page: Page, timeout = 5_000): Promise<boolean> => {
  const stop = page.locator('button[aria-label*="Stop" i]').first();
  if (!(await stop.isVisible({ timeout: 1_000 }).catch(() => false))) return false;
  await stop.click({ timeout });
  return true;
};

/** Attach local files to the Gemini composer when a file input is available. */
const attachFilesToPrompt = async (page: Page, paths: string[]): Promise<void> => {
  if (paths.length === 0) return;
  const directInput = page.locator(SELECTORS.attachmentInput).first();
  if ((await directInput.count()) > 0) {
    await directInput.setInputFiles(paths);
    return;
  }
  await attachViaButton({ page, paths });
};

const attachViaButton = async (input: { page: Page; paths: string[] }): Promise<void> => {
  const attachButton = input.page.locator(SELECTORS.attachmentButton).first();
  if (!(await attachButton.isVisible({ timeout: 2_000 }).catch(() => false))) {
    throw new Error("Gemini file attachment controls are not available on this page.");
  }
  await attachButton.click();
  await setAttachmentFiles(input);
};

const setAttachmentFiles = async (input: { page: Page; paths: string[] }): Promise<void> => {
  const fileInput = input.page.locator(SELECTORS.attachmentInput).first();
  await fileInput.waitFor({ state: "attached", timeout: 5_000 });
  await fileInput.setInputFiles(input.paths);
};

// --- gemini-model.helpers.ts ---
/**
 * True when a string looks like a real Gemini model name.
 *
 * @param value - Value value.
 * @returns Whether the condition matches.
 * @example
 * ```ts
 * const result = isLikelyModelLabel(value);
 * ```
 */
export const isLikelyModelLabel = (value: string): boolean => {
  return /\b(gemini|flash|pro|thinking|advanced|experimental)\b/i.test(value);
};

// --- gemini-model.picker.ts ---

const readModelFromTrigger = async (trigger: Locator): Promise<string> => {
  const text = normalizeDisplayText(await trigger.innerText().catch(() => ""));
  const line = text.split("\n").find((part) => isLikelyModelLabel(part));
  if (line) return line;
  return readTriggerAriaLabel(trigger);
};

const readTriggerAriaLabel = async (trigger: Locator): Promise<string> => {
  const ariaLabel = await trigger.getAttribute("aria-label").catch(() => null);
  if (ariaLabel && isLikelyModelLabel(ariaLabel)) return ariaLabel.trim();
  return "Gemini";
};

const collectMenuModels = async (page: Page): Promise<ModelOption[]> => {
  const items = page.locator(
    `${SELECTORS.openMenu} [role="menuitem"], ${SELECTORS.openMenu} [role="option"]`,
  );
  const count = await items.count();
  const models: ModelOption[] = [];
  for (let i = 0; i < count; i += 1) {
    const model = await readMenuItemModel(items.nth(i));
    if (model) models.push(model);
  }
  return models;
};

const readMenuItemModel = async (item: Locator): Promise<ModelOption | null> => {
  const label = normalizeDisplayText(await item.innerText().catch(() => ""));
  if (!label || !isLikelyModelLabel(label)) return null;
  const selected =
    (await item.getAttribute("aria-checked").catch(() => null)) === "true" ||
    (await item.getAttribute("aria-selected").catch(() => null)) === "true";
  return { id: label.toLowerCase().replace(/\s+/g, "-"), label, selected: !!selected };
};

const firstVisible = async (params: { page: Page; selector: string }): Promise<Locator | null> => {
  const locator = params.page.locator(params.selector);
  const count = await locator.count();
  for (let i = 0; i < count; i += 1) {
    const candidate = locator.nth(i);
    if (await candidate.isVisible().catch(() => false)) return candidate;
  }
  return null;
};

// --- gemini-model.ts ---

/** Detect the currently selected Gemini model from the page DOM. */
const detectCurrentModel = async (page: Page): Promise<string> => {
  try {
    const trigger = await firstVisible({ page, selector: SELECTORS.modelTrigger });
    if (!trigger) return "Gemini";
    return await readModelFromTrigger(trigger);
  } catch {
    return "Gemini";
  }
};

/** List models exposed by Gemini's model picker when it can be opened. */
const listAvailableModels = async (page: Page): Promise<ModelOption[]> => {
  const trigger = await firstVisible({ page, selector: SELECTORS.modelTrigger });
  if (!trigger) return [];
  return collectModelsFromOpenMenu({ page, trigger });
};

const collectModelsFromOpenMenu = async (input: {
  page: Page;
  trigger: Locator;
}): Promise<ModelOption[]> => {
  await input.trigger.click().catch(() => {});
  await input.page.waitForSelector(SELECTORS.openMenu, { timeout: 3_000 }).catch(() => {});
  const models = await collectMenuModels(input.page);
  await input.page.keyboard.press("Escape").catch(() => {});
  return models;
};

/** Switch Gemini to a model exposed by the browser model picker. */
const selectModel = async (page: Page, query: string): Promise<string> => {
  const match = await findModelMatch({ page, query });
  await clickModelMenuItem({ page, label: match.label });
  return match.label;
};

const clickModelMenuItem = async (input: { page: Page; label: string }): Promise<void> => {
  const trigger = await firstVisible({ page: input.page, selector: SELECTORS.modelTrigger });
  if (!trigger) throw new Error("Gemini model picker is not available.");
  await trigger.click();
  await selectMenuModelItem(input);
};

const selectMenuModelItem = async (input: { page: Page; label: string }): Promise<void> => {
  await input.page.waitForSelector(SELECTORS.openMenu, { timeout: 3_000 });
  await input.page
    .locator(`${SELECTORS.openMenu} [role="menuitem"], ${SELECTORS.openMenu} [role="option"]`)
    .filter({ hasText: input.label })
    .first()
    .click();
  await input.page.keyboard.press("Escape").catch(() => {});
};

const findModelMatch = async (input: { page: Page; query: string }): Promise<ModelOption> => {
  const models = await listAvailableModels(input.page);
  const normalizedQuery = input.query.trim().toLowerCase();
  const match = models.find(
    (model) =>
      model.label.toLowerCase().includes(normalizedQuery) ||
      model.id.includes(normalizedQuery.replace(/\s+/g, "-")),
  );
  if (!match) throw new Error(`Model not found in Gemini picker: ${input.query}`);
  return match;
};

// --- gemini-navigation.ts ---

/** True when Gemini is showing the unauthenticated shell. */
const isGuestSession = async (page: Page): Promise<boolean> => {
  const input = page.locator(SELECTORS.promptInput).first();
  if (await input.isVisible({ timeout: 2500 }).catch(() => false)) return false;
  const signIn = page.locator(SELECTORS.signInButton).first();
  return signIn.isVisible({ timeout: 1500 }).catch(() => true);
};

/** Fail fast before sending a prompt to an unauthenticated session. */
const assertSignedIn = async (page: Page): Promise<void> => {
  if (await isGuestSession(page)) {
    throw new GuestSessionError({
      providerId: "gemini",
      reason:
        "Run `bridge chrome start --provider gemini`, click Sign in if needed, complete Google sign-in, leave Chrome open, then run again.",
    });
  }
};

/** Read the conversation list from Gemini's sidebar when available. */
const readSidebarConversations = async (
  page: Page,
): Promise<Array<{ id: string; title: string; url: string }>> => {
  const links = await page.locator(SELECTORS.sidebarConversation).all();
  const conversations: Array<{ id: string; title: string; url: string }> = [];
  for (const link of links) {
    const href = await link.getAttribute("href");
    const title = normalizeDisplayText(await link.innerText().catch(() => ""));
    if (!href || !title) continue;
    conversations.push(conversationEntry({ href, title }));
  }
  return conversations;
};

/** Navigate to a specific Gemini conversation by URL. */
const navigateToConversation = async (page: Page, url: string): Promise<void> => {
  await page.goto(url);
  await page.waitForSelector(SELECTORS.promptInput, { timeout: 30_000 });
};

/** Start a new Gemini conversation. */
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
  const id = input.href.split("/").filter(Boolean).pop() ?? input.href;
  return { id, title: input.title, url };
};

// --- inject-prompt.ts ---

/**
 * Type a prompt into Gemini's composer and confirm it was sent.
 *
 * @param page - Playwright page to operate on.
 * @param text - Text value.
 * @returns Completes when `injectPrompt` finishes.
 * @example
 * ```ts
 * await injectPrompt(page, text);
 * ```
 */
export const injectPrompt = async (page: Page, text: string): Promise<void> => {
  await page.bringToFront().catch(() => {});
  const input = page.locator(SELECTORS.promptInput).first();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // Wait out any in-flight response before typing so a retry never sends on top of one.
    await waitForResponseIdle(page, SELECTORS.streamingIndicator);
    await fillAndSend({ page, input, text });
    if (await composerClears({ page })) return;
    if (await isResponseGenerating(page, SELECTORS.streamingIndicator)) return;
  }
  throw new Error("injectPrompt: composer never cleared after 3 send attempts");
};

const fillAndSend = async (params: { page: Page; input: Locator; text: string }): Promise<void> => {
  await params.input.click();
  await params.input.fill(params.text);
  await params.input.dispatchEvent("input");
  await clickSendOrEnter(params.page);
};

const clickSendOrEnter = async (page: Page): Promise<void> => {
  const sendBtn = page.locator(SELECTORS.sendButton).first();
  try {
    await sendBtn.waitFor({ state: "visible", timeout: 5_000 });
    await sendBtn.click();
    return;
  } catch {
    // Send button never surfaced; fall through to the Enter fallback unless a reply streams.
  }
  // Pressing Enter mid-stream would either no-op or interrupt Gemini's reply — hold until idle.
  if (await isResponseGenerating(page, SELECTORS.streamingIndicator)) return;
  await page.keyboard.press("Enter");
};

const composerClears = async (params: { page: Page }): Promise<boolean> => {
  for (let poll = 0; poll < 10; poll += 1) {
    if ((await readComposerText(params.page)) === "") return true;
    await params.page.waitForTimeout(500);
  }
  return false;
};

const readComposerText = async (page: Page): Promise<string> => {
  return page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(
      "div.ql-editor, [contenteditable='true'][role='textbox']",
    );
    return (editor?.innerText ?? "").trim();
  });
};

// --- wait-response.helpers.ts ---

/** Parsed timeout and baseline fields for Gemini response waits. */
interface ParsedWaitOptions {
  timeout: number;
  previousAssistantCount?: number;
  previousLastAssistantText?: string;
}

const parseWaitOptions = (
  options:
    | number
    | {
        timeout?: number;
        previousAssistantCount?: number;
        previousLastAssistantText?: string;
      },
): ParsedWaitOptions => {
  if (typeof options === "number") return { timeout: options };
  return {
    timeout: options.timeout ?? 300_000,
    previousAssistantCount: options.previousAssistantCount,
    previousLastAssistantText: normalizeDisplayText(options.previousLastAssistantText ?? ""),
  };
};

const remainingTimeout = (startedAt: number, timeout: number): number => {
  return Math.max(1_000, timeout - (Date.now() - startedAt));
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

const baselineAdvanced = async (input: {
  page: Page;
  options: ParsedWaitOptions;
}): Promise<boolean> => {
  if (await hasStreamingIndicator(input.page)) return true;
  if (await assistantCountAdvanced(input)) return true;
  return lastAssistantTextAdvanced(input);
};

const hasStreamingIndicator = async (page: Page): Promise<boolean> => {
  return page
    .locator(SELECTORS.streamingIndicator)
    .first()
    .isVisible()
    .catch(() => false);
};

const assistantCountAdvanced = async (input: {
  page: Page;
  options: ParsedWaitOptions;
}): Promise<boolean> => {
  if (input.options.previousAssistantCount === undefined) return false;
  const count = await countAssistantResponses(input.page);
  return count > input.options.previousAssistantCount;
};

const lastAssistantTextAdvanced = async (input: {
  page: Page;
  options: ParsedWaitOptions;
}): Promise<boolean> => {
  const lastText = normalizeDisplayText(await captureLastResponse(input.page).catch(() => ""));
  return (
    !!input.options.previousLastAssistantText &&
    !!lastText &&
    lastText !== input.options.previousLastAssistantText
  );
};

/**
 * Decide whether the current assistant turn has finished producing output.
 * Pure helper so completion policy is unit-testable without a browser.
 *
 * @param state - State value.
 * @returns Whether the condition matches.
 * @example
 * ```ts
 * const result = isTurnSettled(state);
 * ```
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

/** Wait for Gemini to finish streaming its response. */
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
  if (input.parsed.previousAssistantCount !== undefined || input.parsed.previousLastAssistantText) {
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
        hasText: !!snapshot.text,
        isTransientText: isTransientAssistantText(snapshot.text),
        streaming: snapshot.streaming,
        stableForMs: Date.now() - stableSince,
      })
    )
      return;
    await input.page.waitForTimeout(500);
  }
  throw new Error("Timed out waiting for Gemini response to settle.");
};

const readStabilitySnapshot = async (page: Page): Promise<{ text: string; streaming: boolean }> => {
  const text = normalizeDisplayText(await captureLastResponse(page).catch(() => ""));
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
