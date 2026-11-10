import type { Locator, Page } from "playwright";
import { PROVIDER_CONFIG } from "@/config";
import type { ModelOption } from "@/domain/connector-types.ts";
import type { BrowserProvider, ResponseWaitOptions } from "@/providers/browser-provider.ts";
import { createGuestSessionError } from "@/providers/provider-errors.ts";
import { isResponseGenerating, waitForResponseIdle } from "@/providers/streaming-guard.ts";

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
  const isNothingFound = count === 0;
  if (isNothingFound) return "";

  const text = normalizeDisplayText(
    await blocks
      .nth(count - 1)
      .innerText()
      .catch(() => ""),
  );
  return stripGeminiResponseHeading(text);
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
  const isStopButtonHidden = !(await stopButton.isVisible({ timeout: 1_000 }).catch(() => false));
  if (isStopButtonHidden) return false;

  await stopButton.click({ timeout });
  return true;
};

const attachFilesToPrompt = async (page: Page, paths: string[]): Promise<void> => {
  const isPathsEmpty = paths.length === 0;
  if (isPathsEmpty) return;

  const directInput = page.locator(SELECTORS.attachmentInput).first();
  const hasDirectInput = (await directInput.count()) > 0;
  if (hasDirectInput) {
    await directInput.setInputFiles(paths);
    return;
  }

  await attachViaButton({ page, paths });
};

const attachViaButton = async (input: { page: Page; paths: string[] }): Promise<void> => {
  const attachButton = input.page.locator(SELECTORS.attachmentButton).first();
  const isAttachButtonHidden = !(await attachButton
    .isVisible({ timeout: 2_000 })
    .catch(() => false));
  if (isAttachButtonHidden) {
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

export const isLikelyModelLabel = (label: string): boolean => {
  return /\b(gemini|flash|pro|thinking|advanced|experimental)\b/i.test(label);
};

const readModelFromTrigger = async (trigger: Locator): Promise<string> => {
  const text = normalizeDisplayText(await trigger.innerText().catch(() => ""));
  const line = text.split("\n").find((part) => isLikelyModelLabel(part));

  const hasLine = line !== undefined;
  if (hasLine) return line;

  return readTriggerAriaLabel(trigger);
};

const readTriggerAriaLabel = async (trigger: Locator): Promise<string> => {
  const ariaLabel = await trigger.getAttribute("aria-label").catch(() => null);
  const isAriaLabelUsable = ariaLabel !== null && isLikelyModelLabel(ariaLabel);
  if (isAriaLabelUsable) return ariaLabel.trim();

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

    const hasModel = model !== undefined;
    if (hasModel) models.push(model);
  }
  return models;
};

const readMenuItemModel = async (item: Locator): Promise<ModelOption | undefined> => {
  const label = normalizeDisplayText(await item.innerText().catch(() => ""));
  const isLabelUnusable = label === "" || !isLikelyModelLabel(label);
  if (isLabelUnusable) return undefined;

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
    const isCandidateVisible = await candidate.isVisible().catch(() => false);
    if (isCandidateVisible) return candidate;
  }
  return undefined;
};

const detectCurrentModel = async (page: Page): Promise<string> => {
  try {
    const trigger = await firstVisible({ page, selector: SELECTORS.modelTrigger });

    const isTriggerMissing = trigger === undefined;
    if (isTriggerMissing) return "Gemini";

    return await readModelFromTrigger(trigger);
  } catch {
    return "Gemini";
  }
};

const listAvailableModels = async (page: Page): Promise<ModelOption[]> => {
  const trigger = await firstVisible({ page, selector: SELECTORS.modelTrigger });

  const isTriggerMissing = trigger === undefined;
  if (isTriggerMissing) return [];

  return collectModelsFromOpenMenu({ page, trigger });
};

const collectModelsFromOpenMenu = async (input: {
  page: Page;
  trigger: Locator;
}): Promise<ModelOption[]> => {
  await input.trigger.click().catch(() => undefined);
  await input.page.waitForSelector(SELECTORS.openMenu, { timeout: 3_000 }).catch(() => undefined);
  const models = await collectMenuModels(input.page);
  await input.page.keyboard.press("Escape").catch(() => undefined);
  return models;
};

const selectModel = async (page: Page, query: string): Promise<string> => {
  const match = await findModelMatch({ page, query });
  await clickModelMenuItem({ page, label: match.label });
  return match.label;
};

const clickModelMenuItem = async (input: { page: Page; label: string }): Promise<void> => {
  const trigger = await firstVisible({ page: input.page, selector: SELECTORS.modelTrigger });

  const isTriggerMissing = trigger === undefined;
  if (isTriggerMissing) throw new Error("Gemini model picker is not available.");

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
  await input.page.keyboard.press("Escape").catch(() => undefined);
};

const findModelMatch = async (input: { page: Page; query: string }): Promise<ModelOption> => {
  const models = await listAvailableModels(input.page);
  const normalizedQuery = input.query.trim().toLowerCase();

  const match = models.find(
    (model) =>
      model.label.toLowerCase().includes(normalizedQuery) ||
      model.id.includes(normalizedQuery.replace(/\s+/g, "-")),
  );
  const isMatchMissing = match === undefined;
  if (isMatchMissing) throw new Error(`Model not found in Gemini picker: ${input.query}`);

  return match;
};

const isGuestSession = async (page: Page): Promise<boolean> => {
  const composer = page.locator(SELECTORS.promptInput).filter({ visible: true }).first();
  const isComposerVisible = await composer.isVisible({ timeout: 2500 }).catch(() => false);
  if (isComposerVisible) return false;

  const signIn = page.locator(SELECTORS.signInButton).first();
  return signIn.isVisible({ timeout: 1500 }).catch(() => true);
};

const assertSignedIn = async (page: Page): Promise<void> => {
  const isGuestSessionDetected = await isGuestSession(page);
  if (isGuestSessionDetected) {
    throw createGuestSessionError({
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

    const title = normalizeDisplayText(await link.innerText().catch(() => ""));
    const isLinkIncomplete = href === null || href === "" || title === "";
    if (isLinkIncomplete) continue;

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
  const isAbsoluteHref = input.href.startsWith("http");
  const url = isAbsoluteHref ? input.href : `https://gemini.google.com${input.href}`;
  const pathSegment = input.href.split("/").filter(Boolean).pop();
  const isPathSegmentMissing = pathSegment === undefined;
  const id = isPathSegmentMissing ? input.href : pathSegment;
  return { id, title: input.title, url };
};

export const injectPrompt = async (page: Page, text: string): Promise<void> => {
  await page.bringToFront().catch(() => undefined);
  const composer = page.locator(SELECTORS.promptInput).filter({ visible: true }).first();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // Wait out any in-flight response before typing so a retry never sends on top of one.
    await waitForResponseIdle(page, SELECTORS.streamingIndicator);
    await fillAndSend({ page, composer, text });

    const hasComposerCleared = await composerClears(page);
    if (hasComposerCleared) return;

    const isStillStreaming = await isResponseGenerating(page, SELECTORS.streamingIndicator);
    if (isStillStreaming) return;
  }
  throw new Error("injectPrompt: composer never cleared after 3 send attempts");
};

const fillAndSend = async (input: {
  page: Page;
  composer: Locator;
  text: string;
}): Promise<void> => {
  await input.composer.click();
  await input.composer.fill(input.text);
  await input.composer.dispatchEvent("input");
  await clickSendOrEnter(input.page);
};

const clickSendOrEnter = async (page: Page): Promise<void> => {
  const sendButton = page.locator(SELECTORS.sendButton).filter({ visible: true }).first();
  try {
    await sendButton.waitFor({ state: "visible", timeout: 5_000 });
    await sendButton.click();
    return;
  } catch {
    // Send button never surfaced; fall through to the Enter fallback unless a reply streams.
  }

  // Pressing Enter mid-stream would either no-op or interrupt Gemini's reply — hold until idle.
  const isStillStreamingLater = await isResponseGenerating(page, SELECTORS.streamingIndicator);
  if (isStillStreamingLater) return;

  await page.keyboard.press("Enter");
};

const composerClears = async (page: Page): Promise<boolean> => {
  for (let poll = 0; poll < 10; poll += 1) {
    const isComposerEmpty = (await readComposerText(page)) === "";
    if (isComposerEmpty) return true;

    await page.waitForTimeout(500);
  }
  return false;
};

const readComposerText = async (page: Page): Promise<string> => {
  return page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(
      "div.ql-editor, [contenteditable='true'][role='textbox']",
    );

    const isEditorMissing = editor === null;
    if (isEditorMissing) return "";

    return editor.innerText.trim();
  });
};

type ParsedWaitOptions = {
  timeout: number;
  previousAssistantCount?: number;
  previousLastAssistantText?: string;
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
  const isWaitTypeNumber = typeof waitOptions === "number";
  if (isWaitTypeNumber) return { timeout: waitOptions };

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
    const hasBaselineAdvanced = await baselineAdvanced({ page, options });
    if (hasBaselineAdvanced) return;

    await page.waitForTimeout(250);
  }
  throw new Error("Timed out waiting for Gemini to start a new response.");
};

const baselineAdvanced = async (input: {
  page: Page;
  options: ParsedWaitOptions;
}): Promise<boolean> => {
  const isStreamingIndicatorShown = await hasStreamingIndicator(input.page);
  if (isStreamingIndicatorShown) return true;

  const hasMoreAssistantTurns = await assistantCountAdvanced(input);
  if (hasMoreAssistantTurns) return true;

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
  const previousText = input.options.previousLastAssistantText;
  const isPreviousBlank = previousText === undefined || previousText === "";
  if (isPreviousBlank) return false;

  const lastText = normalizeDisplayText(await captureLastResponse(input.page).catch(() => ""));
  const isLastEmpty = lastText === "";
  if (isLastEmpty) return false;

  return lastText !== previousText;
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

  const isStillSettling = state.stableForMs < SETTLE_QUIET_MS;
  if (isStillSettling) return false;

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
    const hasSnapshotChanged = snapshot.text !== lastText;
    if (hasSnapshotChanged) {
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
