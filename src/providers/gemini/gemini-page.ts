import type { Locator, Page } from "playwright";
import { PROVIDER_SETTINGS } from "@/config";
import type { ModelOption } from "@/domain/connector-types.ts";
import type { BrowserProvider, ReplyWaitSettings } from "@/providers/browser-provider.ts";
import { createGuestSessionError } from "@/providers/provider-errors.ts";
import { isReplyGenerating, waitForReplyIdle } from "@/providers/streaming-guard.ts";

const UI_SETTLE_MILLISECONDS = 500;

const PROMPT_FIELD_WAIT_TIMEOUT_MILLISECONDS = 30_000;

const MENU_WAIT_TIMEOUT_MILLISECONDS = 3_000;

const stopButtonCheckTimeoutMilliseconds = 1_000;

const minimumReplyWaitMilliseconds = 1000;

const CONTROL_WAIT_TIMEOUT_MILLISECONDS = 5_000;

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
  responseBlock: PROVIDER_SETTINGS.gemini.selectors.assistant,
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

const SETTLE_QUIET_MS = 1_500;

const cleanVisibleCopy = (visibleCopy: string): string => {
  return visibleCopy
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const stripGeminiReplyHeading = (reply: string): string => {
  return reply.replace(/^Gemini said\s*/i, "").trim();
};

const captureLastReply = async (page: Page): Promise<string> => {
  const blocks = page.locator(SELECTORS.responseBlock);

  const count = await blocks.count();

  const isNothingFound = count === 0;
  if (isNothingFound) return "";

  const displayReply = cleanVisibleCopy(
    await blocks
      .nth(count - 1)
      .innerText()
      .catch(() => ""),
  );
  return stripGeminiReplyHeading(displayReply);
};

const countAssistantReplies = async (page: Page): Promise<number> => {
  return page.locator(SELECTORS.responseBlock).count();
};

const captureAllMessages = async (
  page: Page,
): Promise<Array<{ role: string; content: string }>> => {
  return page.evaluate(`(() => {
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
    const isInnerTextMissing = typeof rawText !== "string";

    if (isInnerTextMissing) continue;

    const messageText = rawText.trim();
    const isMessageEmpty = messageText === "";

    if (isMessageEmpty) continue;

    messages.push({ role: turn.role, content: messageText });
  }
  return messages;
})()`);
};

// Gemini web does not expose ChatGPT-style prompt rewind; fail clearly.
const rewindLastUserPrompt = async (_page: Page, _replacement?: string): Promise<void> => {
  throw new Error("Rewind is not supported on gemini.google.com yet.");
};

const stopGenerating = async (
  page: Page,
  timeout = CONTROL_WAIT_TIMEOUT_MILLISECONDS,
): Promise<boolean> => {
  const stopButton = page.locator('button[aria-label*="Stop" i]').first();
  const stopButtonVisible = await stopButton
    .isVisible({ timeout: stopButtonCheckTimeoutMilliseconds })
    .catch(() => false);

  const isStopButtonHidden = !stopButtonVisible;
  if (isStopButtonHidden) return false;

  await stopButton.click({ timeout });
  return true;
};

const attachFilesToPrompt = async (page: Page, paths: string[]): Promise<void> => {
  const isPathsEmpty = paths.length === 0;
  if (isPathsEmpty) return;

  const attachmentField = page.locator(SELECTORS.attachmentInput).first();
  const attachmentFieldCount = await attachmentField.count();

  const hasAttachmentField = attachmentFieldCount > 0;
  if (hasAttachmentField) {
    await attachmentField.setInputFiles(paths);
    return;
  }

  await attachViaButton({ page, paths });
};

const attachViaButton = async (request: { page: Page; paths: string[] }): Promise<void> => {
  const attachButton = request.page.locator(SELECTORS.attachmentButton).first();
  const attachButtonVisibilityTimeoutMilliseconds = 2_000;

  const attachButtonVisible = await attachButton
    .isVisible({ timeout: attachButtonVisibilityTimeoutMilliseconds })
    .catch(() => false);

  const isAttachButtonHidden = !attachButtonVisible;
  if (isAttachButtonHidden) {
    throw new Error("Gemini file attachment controls are not available on this page.");
  }

  await attachButton.click();
  await setAttachmentFiles(request);
};

const setAttachmentFiles = async (request: { page: Page; paths: string[] }): Promise<void> => {
  const fileUpload = request.page.locator(SELECTORS.attachmentInput).first();
  await fileUpload.waitFor({ state: "attached", timeout: CONTROL_WAIT_TIMEOUT_MILLISECONDS });
  await fileUpload.setInputFiles(request.paths);
};

export const isLikelyModelLabel = (label: string): boolean => {
  return /\b(gemini|flash|pro|thinking|advanced|experimental)\b/i.test(label);
};

const readModelFromTrigger = async (trigger: Locator): Promise<string> => {
  const triggerLabel = cleanVisibleCopy(await trigger.innerText().catch(() => ""));
  const line = triggerLabel.split("\n").find((part) => isLikelyModelLabel(part));

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
  const menuElements = page.locator(
    `${SELECTORS.openMenu} [role="menuitem"], ${SELECTORS.openMenu} [role="option"]`,
  );
  const count = await menuElements.count();
  const models: ModelOption[] = [];
  for (let index = 0; index < count; index += 1) {
    const menuElement = menuElements.nth(index);
    const model = await readMenuElementModel(menuElement);

    const hasModel = model !== undefined;
    if (hasModel) models.push(model);
  }
  return models;
};

const readMenuElementModel = async (element: Locator): Promise<ModelOption | undefined> => {
  const label = cleanVisibleCopy(await element.innerText().catch(() => ""));

  const isLabelUnusable = label === "" || !isLikelyModelLabel(label);
  if (isLabelUnusable) return undefined;

  const selected =
    (await element.getAttribute("aria-checked").catch(() => null)) === "true" ||
    (await element.getAttribute("aria-selected").catch(() => null)) === "true";
  return { id: label.toLowerCase().replace(/\s+/g, "-"), label, selected };
};

const readFirstVisible = async (request: {
  page: Page;
  selector: string;
}): Promise<Locator | undefined> => {
  const locator = request.page.locator(request.selector);
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
    const trigger = await readFirstVisible({ page, selector: SELECTORS.modelTrigger });

    const isTriggerMissing = trigger === undefined;
    if (isTriggerMissing) return "Gemini";

    return await readModelFromTrigger(trigger);
  } catch {
    return "Gemini";
  }
};

const listAvailableModels = async (page: Page): Promise<ModelOption[]> => {
  const trigger = await readFirstVisible({ page, selector: SELECTORS.modelTrigger });

  const isTriggerMissing = trigger === undefined;
  if (isTriggerMissing) return [];

  return collectModelsFromOpenMenu({ page, trigger });
};

const collectModelsFromOpenMenu = async (request: {
  page: Page;
  trigger: Locator;
}): Promise<ModelOption[]> => {
  await request.trigger.click().catch(() => undefined);
  await request.page
    .waitForSelector(SELECTORS.openMenu, { timeout: MENU_WAIT_TIMEOUT_MILLISECONDS })
    .catch(() => undefined);
  const models = await collectMenuModels(request.page);
  await request.page.keyboard.press("Escape").catch(() => undefined);
  return models;
};

const selectModel = async (page: Page, query: string): Promise<string> => {
  const matchedModel = await findModel({ page, query });
  await clickModelMenuElement({ page, label: matchedModel.label });
  return matchedModel.label;
};

const clickModelMenuElement = async (request: { page: Page; label: string }): Promise<void> => {
  const trigger = await readFirstVisible({ page: request.page, selector: SELECTORS.modelTrigger });

  const isTriggerMissing = trigger === undefined;
  if (isTriggerMissing) throw new Error("Gemini model picker is not available.");

  await trigger.click();
  await selectMenuModelElement(request);
};

const selectMenuModelElement = async (request: { page: Page; label: string }): Promise<void> => {
  await request.page.waitForSelector(SELECTORS.openMenu, {
    timeout: MENU_WAIT_TIMEOUT_MILLISECONDS,
  });
  await request.page
    .locator(`${SELECTORS.openMenu} [role="menuitem"], ${SELECTORS.openMenu} [role="option"]`)
    .filter({ hasText: request.label })
    .first()
    .click();
  await request.page.keyboard.press("Escape").catch(() => undefined);
};

const findModel = async (request: { page: Page; query: string }): Promise<ModelOption> => {
  const models = await listAvailableModels(request.page);
  const normalizedQuery = request.query.trim().toLowerCase();

  const matchedModel = models.find(
    (model) =>
      model.label.toLowerCase().includes(normalizedQuery) ||
      model.id.includes(normalizedQuery.replace(/\s+/g, "-")),
  );

  const isModelMissing = matchedModel === undefined;
  if (isModelMissing) throw new Error(`Model not found in Gemini picker: ${request.query}`);

  return matchedModel;
};

const isGuestSession = async (page: Page): Promise<boolean> => {
  const composer = page.locator(SELECTORS.promptInput).filter({ visible: true }).first();
  const promptFieldVisibilityTimeoutMilliseconds = 2500;

  const isComposerVisible = await composer
    .isVisible({ timeout: promptFieldVisibilityTimeoutMilliseconds })
    .catch(() => false);
  if (isComposerVisible) return false;

  const signIn = page.locator(SELECTORS.signInButton).first();
  const signInVisibilityTimeoutMilliseconds = 1500;

  return signIn.isVisible({ timeout: signInVisibilityTimeoutMilliseconds }).catch(() => true);
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

    const title = cleanVisibleCopy(await link.innerText().catch(() => ""));

    const isLinkIncomplete = href === null || href === "" || title === "";
    if (isLinkIncomplete) continue;

    const conversationLink = readConversationLink({ href, title });
    conversations.push(conversationLink);
  }
  return conversations;
};

const navigateToConversation = async (page: Page, url: string): Promise<void> => {
  await page.goto(url);
  await page.waitForSelector(SELECTORS.promptInput, {
    timeout: PROMPT_FIELD_WAIT_TIMEOUT_MILLISECONDS,
  });
};

const startNewConversation = async (page: Page): Promise<void> => {
  await page.goto("https://gemini.google.com/app");
  await page.waitForSelector(SELECTORS.promptInput, {
    timeout: PROMPT_FIELD_WAIT_TIMEOUT_MILLISECONDS,
  });
};

const readConversationLink = (request: {
  href: string;
  title: string;
}): {
  id: string;
  title: string;
  url: string;
} => {
  const isAbsoluteHref = request.href.startsWith("http");
  const url = isAbsoluteHref ? request.href : `https://gemini.google.com${request.href}`;
  const pathSegment = request.href.split("/").filter(Boolean).pop();
  const isPathSegmentMissing = pathSegment === undefined;
  const id = isPathSegmentMissing ? request.href : pathSegment;
  return { id, title: request.title, url };
};

export const injectPrompt = async (page: Page, prompt: string): Promise<void> => {
  await page.bringToFront().catch(() => undefined);
  const composer = page.locator(SELECTORS.promptInput).filter({ visible: true }).first();
  const maxPromptInjectAttempts = 3;

  for (let attempt = 0; attempt < maxPromptInjectAttempts; attempt += 1) {
    // Wait out any in-flight response before typing so a retry never sends on top of one.
    await waitForReplyIdle(page, SELECTORS.streamingIndicator);
    await fillComposerAndSend({ page, composer, text: prompt });

    const hasComposerCleared = await isComposerClears(page);
    if (hasComposerCleared) return;

    const isStillStreaming = await isReplyGenerating(page, SELECTORS.streamingIndicator);
    if (isStillStreaming) return;
  }
  throw new Error("injectPrompt: composer never cleared after 3 send attempts");
};

const fillComposerAndSend = async (request: {
  page: Page;
  composer: Locator;
  text: string;
}): Promise<void> => {
  await request.composer.click();
  await request.composer.fill(request.text);
  await request.composer.dispatchEvent("input");
  await clickSendOrEnter(request.page);
};

const clickSendOrEnter = async (page: Page): Promise<void> => {
  const sendButton = page.locator(SELECTORS.sendButton).filter({ visible: true }).first();
  try {
    await sendButton.waitFor({ state: "visible", timeout: CONTROL_WAIT_TIMEOUT_MILLISECONDS });
    await sendButton.click();
    return;
  } catch {
    // Send button never surfaced; fall through to the Enter fallback unless a reply streams.
  }

  // Pressing Enter mid-stream would either no-op or interrupt Gemini's reply — hold until idle.
  const isStillStreamingLater = await isReplyGenerating(page, SELECTORS.streamingIndicator);
  if (isStillStreamingLater) return;

  await page.keyboard.press("Enter");
};

const isComposerClears = async (page: Page): Promise<boolean> => {
  const maxComposerClearChecks = 10;

  for (let poll = 0; poll < maxComposerClearChecks; poll += 1) {
    const isComposerEmpty = (await readComposerDraft(page)) === "";
    if (isComposerEmpty) return true;

    await page.waitForTimeout(UI_SETTLE_MILLISECONDS);
  }
  return false;
};

const readComposerDraft = async (page: Page): Promise<string> => {
  return page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(
      "div.ql-editor, [contenteditable='true'][role='textbox']",
    );

    const isEditorMissing = editor === null;
    if (isEditorMissing) return "";

    return editor.innerText.trim();
  });
};

type ParsedWaitSettings = {
  timeout: number;
  previousAssistantCount?: number;
  previousLastAssistantText?: string;
};

const parseWaitSettings = (
  waitSettings:
    | number
    | {
        timeout?: number;
        previousAssistantCount?: number;
        previousLastAssistantText?: string;
      },
): ParsedWaitSettings => {
  const isWaitTypeNumber = typeof waitSettings === "number";
  if (isWaitTypeNumber) return { timeout: waitSettings };

  const actionTimeoutMilliseconds = 300_000;

  const timeout =
    waitSettings.timeout === undefined ? actionTimeoutMilliseconds : waitSettings.timeout;
  const previousLastAssistantReply =
    waitSettings.previousLastAssistantText === undefined
      ? ""
      : waitSettings.previousLastAssistantText;

  return {
    timeout,
    previousAssistantCount: waitSettings.previousAssistantCount,
    previousLastAssistantText: cleanVisibleCopy(previousLastAssistantReply),
  };
};

const readRemainingTimeout = (startedAt: number, timeout: number): number => {
  return Math.max(minimumReplyWaitMilliseconds, timeout - (Date.now() - startedAt));
};

const isTransientAssistantReply = (reply: string): boolean => {
  const normalized = reply.trim().toLowerCase();
  return (
    normalized === "thinking" ||
    normalized.endsWith(" thinking") ||
    normalized.endsWith(" thinking...") ||
    /^thinking[.\s]*$/.test(normalized)
  );
};

const waitForReplyAfterBaseline = async (
  page: Page,
  settings: ParsedWaitSettings,
): Promise<void> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < settings.timeout) {
    const hasBaselineAdvanced = await isBaselineAdvanced({ page, options: settings });
    if (hasBaselineAdvanced) return;

    const replyBaselinePollMilliseconds = 250;

    await page.waitForTimeout(replyBaselinePollMilliseconds);
  }
  throw new Error("Timed out waiting for Gemini to start a new response.");
};

const isBaselineAdvanced = async (request: {
  page: Page;
  options: ParsedWaitSettings;
}): Promise<boolean> => {
  const isStreamingIndicatorShown = await hasStreamingIndicator(request.page);
  if (isStreamingIndicatorShown) return true;

  const hasMoreAssistantTurns = await isAssistantCountAdvanced(request);
  if (hasMoreAssistantTurns) return true;

  return isLastAssistantReplyAdvanced(request);
};

const hasStreamingIndicator = async (page: Page): Promise<boolean> => {
  return page
    .locator(SELECTORS.streamingIndicator)
    .first()
    .isVisible()
    .catch(() => false);
};

const isAssistantCountAdvanced = async (request: {
  page: Page;
  options: ParsedWaitSettings;
}): Promise<boolean> => {
  if (request.options.previousAssistantCount === undefined) return false;

  const count = await countAssistantReplies(request.page);
  return count > request.options.previousAssistantCount;
};

const isLastAssistantReplyAdvanced = async (request: {
  page: Page;
  options: ParsedWaitSettings;
}): Promise<boolean> => {
  const previousReply = request.options.previousLastAssistantText;

  const isPreviousBlank = previousReply === undefined || previousReply === "";
  if (isPreviousBlank) return false;

  const lastReply = cleanVisibleCopy(await captureLastReply(request.page).catch(() => ""));

  const isLastEmpty = lastReply === "";
  if (isLastEmpty) return false;

  return lastReply !== previousReply;
};

export const isTurnSettled = (turn: {
  hasText: boolean;
  isTransientText: boolean;
  streaming: boolean;
  stableForMs: number;
}): boolean => {
  if (turn.streaming) return false;

  const isStillSettling = turn.stableForMs < SETTLE_QUIET_MS;
  if (isStillSettling) return false;

  return turn.hasText && !turn.isTransientText;
};

const waitForReply = async (
  page: Page,
  settings: number | ReplyWaitSettings = {},
): Promise<void> => {
  const parsed = parseWaitSettings(settings);
  const startedAt = Date.now();
  await waitForInitialReply({ page, parsed });
  await waitForStreamingEnd({ page, startedAt, timeout: parsed.timeout });
  await waitForLastAssistantReplyStable({
    page,
    timeout: readRemainingTimeout(startedAt, parsed.timeout),
  });
};

const waitForInitialReply = async (request: {
  page: Page;
  parsed: ParsedWaitSettings;
}): Promise<void> => {
  if (
    request.parsed.previousAssistantCount !== undefined ||
    (request.parsed.previousLastAssistantText !== undefined &&
      request.parsed.previousLastAssistantText !== "")
  ) {
    await waitForReplyAfterBaseline(request.page, request.parsed);
    return;
  }

  await request.page.waitForSelector(SELECTORS.responseBlock, { timeout: request.parsed.timeout });
};

const waitForStreamingEnd = async (request: {
  page: Page;
  startedAt: number;
  timeout: number;
}): Promise<void> => {
  try {
    const indicator = request.page.locator(SELECTORS.streamingIndicator).first();
    const streamingEndWaitTimeoutMilliseconds = 10_000;

    await indicator.waitFor({ state: "visible", timeout: streamingEndWaitTimeoutMilliseconds });
    await indicator.waitFor({
      state: "hidden",
      timeout: readRemainingTimeout(request.startedAt, request.timeout),
    });
  } catch {
    return;
  }
};

const waitForLastAssistantReplyStable = async (request: {
  page: Page;
  timeout: number;
}): Promise<void> => {
  const startedAt = Date.now();
  let lastReply = "";
  let stableSince = Date.now();
  while (Date.now() - startedAt < request.timeout) {
    const snapshot = await readStabilitySnapshot(request.page);

    const hasSnapshotChanged = snapshot.text !== lastReply;
    if (hasSnapshotChanged) {
      lastReply = snapshot.text;
      stableSince = Date.now();
    }

    if (
      isTurnSettled({
        hasText: snapshot.text !== "",
        isTransientText: isTransientAssistantReply(snapshot.text),
        streaming: snapshot.streaming,
        stableForMs: Date.now() - stableSince,
      })
    ) {
      return;
    }

    await request.page.waitForTimeout(UI_SETTLE_MILLISECONDS);
  }
  throw new Error("Timed out waiting for Gemini response to settle.");
};

const readStabilitySnapshot = async (page: Page): Promise<{ text: string; streaming: boolean }> => {
  const displayReply = cleanVisibleCopy(await captureLastReply(page).catch(() => ""));
  const streaming = await page
    .locator(SELECTORS.streamingIndicator)
    .first()
    .isVisible()
    .catch(() => false);
  return { text: displayReply, streaming };
};

export const geminiProvider = {
  id: "gemini",
  origin: "gemini.google.com",
  defaultUrl: "https://gemini.google.com/app",
  defaultModel: "Gemini",
  displayName: "Gemini",
  composerSelector: PROVIDER_SETTINGS.gemini.selectors.composer,
  supportsMcpConnector: false,
  assertSignedIn,
  injectPrompt,
  waitForReply: waitForReply,
  captureLastReply: captureLastReply,
  countAssistantReplies: countAssistantReplies,
  captureAllMessages,
  readSidebarConversations,
  navigateToConversation,
  newConversation: startNewConversation,
  detectCurrentModel,
  listAvailableModels,
  selectModel,
  rewindLastUserPrompt,
  stopGenerating,
  attachFilesToPrompt,
  isLikelyModelLabel,
} satisfies BrowserProvider;
