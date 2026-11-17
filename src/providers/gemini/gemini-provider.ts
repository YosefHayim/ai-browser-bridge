import type { Locator, Page } from "playwright";
import type { ModelOption } from "@/connector-types.ts";
import { PROVIDER_SETTINGS } from "@/provider-settings.ts";
import type {
  BrowserProvider,
  ProviderProfile,
  ReplyWaitSettings,
} from "@/providers/engine/browser-provider.ts";
import { probeOrFallback, readVisibleCopy } from "@/providers/engine/browser-provider.ts";
import { ESCAPE_KEY, VISIBLE_WAIT_MODE } from "@/providers/engine/page-probes.ts";
import { createGuestSessionError } from "@/providers/engine/provider-errors.ts";
import { isReplyGenerating, waitForReplyIdle } from "@/providers/engine/streaming-guard.ts";
import {
  cleanVisibleCopy,
  isLikelyModelLabel,
  isTransientAssistantReply,
  isTurnSettled,
  type ParsedWaitSettings,
  parseWaitSettings,
  readConversationLink,
  readModelId,
  readRemainingTimeout,
  stripGeminiReplyHeading,
} from "@/providers/gemini/gemini-copy.ts";
import { SELECTORS, STOP_BUTTON_SELECTOR } from "@/providers/gemini/gemini-selectors.ts";

const GEMINI_APP_URL = "https://gemini.google.com/app";

const GEMINI_BUTTON_LABEL = "Gemini";

const UI_SETTLE_MILLISECONDS = 500;

const PROMPT_FIELD_WAIT_TIMEOUT_MILLISECONDS = 30_000;

const MENU_WAIT_TIMEOUT_MILLISECONDS = 3_000;

const CONTROL_WAIT_TIMEOUT_MILLISECONDS = 5_000;

const MENU_CHOICE_SELECTOR = `${SELECTORS.openMenu} [role="menuitem"], ${SELECTORS.openMenu} [role="option"]`;

const ALL_MESSAGES_SCRIPT = `(() => {
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
    // biome-ignore lint/performance/useDomNodeTextContent: the turn copy must match what the user sees
    const turnVisibleText = turn.node.innerText;
    const isTurnTextMissing = typeof turnVisibleText !== "string";

    if (isTurnTextMissing) continue;

    const messageText = turnVisibleText.trim();
    const isMessageEmpty = messageText === "";

    if (isMessageEmpty) continue;

    messages.push({ role: turn.role, content: messageText });
  }
  return messages;
})()`;

export const geminiProfile = {
  id: "gemini",
  origin: PROVIDER_SETTINGS.gemini.origin,
  defaultUrl: GEMINI_APP_URL,
  defaultModel: GEMINI_BUTTON_LABEL,
  displayName: GEMINI_BUTTON_LABEL,
  composerSelector: PROVIDER_SETTINGS.gemini.selectors.composer,
  supportsMcpConnector: false,
} satisfies ProviderProfile;

export class GeminiProvider implements BrowserProvider {
  readonly profile = geminiProfile;

  constructor(private readonly page: Page) {}

  assertSignedIn = async (): Promise<void> => {
    const isGuestSessionDetected = await this.isGuestSession();
    if (isGuestSessionDetected) {
      throw createGuestSessionError({
        providerId: "gemini",
        reason:
          "Run `bridge chrome start --provider gemini`, click Sign in if needed, complete Google sign-in, leave Chrome open, then run again.",
      });
    }
  };

  injectPrompt = async (prompt: string): Promise<void> => {
    await probeOrFallback(null, () => this.page.bringToFront());
    const composer = this.page.locator(SELECTORS.promptInput).filter({ visible: true }).first();
    const maxPromptInjectAttempts = 3;

    for (let attempt = 0; attempt < maxPromptInjectAttempts; attempt += 1) {
      // Wait out any in-flight response before typing so a retry never sends on top of one.
      await waitForReplyIdle(this.page, SELECTORS.streamingIndicator);
      await this.fillComposerAndSend(composer, prompt);

      const hasComposerCleared = await this.isComposerCleared();
      if (hasComposerCleared) return;

      const isStillStreaming = await isReplyGenerating(this.page, SELECTORS.streamingIndicator);
      if (isStillStreaming) return;
    }
    throw new Error("injectPrompt: composer never cleared after 3 send attempts");
  };

  waitForReply = async (settings: number | ReplyWaitSettings = {}): Promise<void> => {
    const parsedSettings = parseWaitSettings(settings);
    const startedAt = Date.now();

    await this.waitForInitialReply(parsedSettings);
    await this.waitForStreamingEnd(startedAt, parsedSettings.timeout);
    const remainingTimeout = readRemainingTimeout(startedAt, parsedSettings.timeout);
    await this.waitForLastAssistantReplyStable(remainingTimeout);
  };

  captureLastReply = async (): Promise<string> => {
    const blocks = this.page.locator(SELECTORS.responseBlock);
    const blockCount = await blocks.count();

    const isNothingFound = blockCount === 0;
    if (isNothingFound) return "";

    const lastBlock = blocks.nth(blockCount - 1);
    const visibleReply = await probeOrFallback("", () => readVisibleCopy(lastBlock));
    const displayReply = cleanVisibleCopy(visibleReply);
    return stripGeminiReplyHeading(displayReply);
  };

  countAssistantReplies = async (): Promise<number> => {
    return this.page.locator(SELECTORS.responseBlock).count();
  };

  captureAllMessages = async (): Promise<Array<{ role: string; content: string }>> => {
    return this.page.evaluate(ALL_MESSAGES_SCRIPT);
  };

  readSidebarConversations = async (): Promise<
    Array<{ id: string; title: string; url: string }>
  > => {
    const links = await this.page.locator(SELECTORS.sidebarConversation).all();
    const conversations: Array<{ id: string; title: string; url: string }> = [];
    for (const link of links) {
      const href = await link.getAttribute("href");
      const visibleTitle = await probeOrFallback("", () => readVisibleCopy(link));
      const title = cleanVisibleCopy(visibleTitle);

      const isHrefMissing = href == null || href === "";
      if (isHrefMissing) continue;

      const isTitleMissing = title === "";
      if (isTitleMissing) continue;

      conversations.push(readConversationLink(href, title));
    }
    return conversations;
  };

  navigateToConversation = async (url: string): Promise<void> => {
    await this.page.goto(url);
    await this.page.waitForSelector(SELECTORS.promptInput, {
      timeout: PROMPT_FIELD_WAIT_TIMEOUT_MILLISECONDS,
    });
  };

  newConversation = async (): Promise<void> => {
    await this.page.goto(GEMINI_APP_URL);
    await this.page.waitForSelector(SELECTORS.promptInput, {
      timeout: PROMPT_FIELD_WAIT_TIMEOUT_MILLISECONDS,
    });
  };

  detectCurrentModel = async (): Promise<string> => {
    return probeOrFallback(GEMINI_BUTTON_LABEL, async () => {
      const trigger = await this.readFirstVisible(SELECTORS.modelTrigger);

      const isTriggerMissing = trigger == null;
      if (isTriggerMissing) return GEMINI_BUTTON_LABEL;

      return this.readModelFromTrigger(trigger);
    });
  };

  listAvailableModels = async (): Promise<ModelOption[]> => {
    const trigger = await this.readFirstVisible(SELECTORS.modelTrigger);

    const isTriggerMissing = trigger == null;
    if (isTriggerMissing) return [];

    return this.collectModelsFromOpenMenu(trigger);
  };

  selectModel = async (query: string): Promise<string> => {
    const matchedModel = await this.findModel(query);
    await this.clickModelMenuElement(matchedModel.label);
    return matchedModel.label;
  };

  // Gemini web does not expose ChatGPT-style prompt rewind; fail clearly.
  rewindLastUserPrompt = async (): Promise<void> => {
    throw new Error("Rewind is not supported on gemini.google.com yet.");
  };

  stopGenerating = async (timeout = CONTROL_WAIT_TIMEOUT_MILLISECONDS): Promise<boolean> => {
    const stopButton = this.page.locator(STOP_BUTTON_SELECTOR).first();
    const stopButtonCheckTimeoutMilliseconds = 1_000;
    const stopButtonVisible = await probeOrFallback(false, () =>
      stopButton.isVisible({ timeout: stopButtonCheckTimeoutMilliseconds }),
    );

    const isStopButtonHidden = !stopButtonVisible;
    if (isStopButtonHidden) return false;

    await stopButton.click({ timeout });
    return true;
  };

  attachFilesToPrompt = async (paths: string[]): Promise<void> => {
    const isPathsEmpty = paths.length === 0;
    if (isPathsEmpty) return;

    const attachmentField = this.page.locator(SELECTORS.attachmentInput).first();
    const attachmentFieldCount = await attachmentField.count();

    const hasAttachmentField = attachmentFieldCount > 0;
    if (hasAttachmentField) {
      await attachmentField.setInputFiles(paths);
      return;
    }

    await this.attachViaButton(paths);
  };

  isLikelyModelLabel = (label: string): boolean => isLikelyModelLabel(label);

  private attachViaButton = async (paths: string[]): Promise<void> => {
    const attachButton = this.page.locator(SELECTORS.attachmentButton).first();
    const attachButtonVisibilityTimeoutMilliseconds = 2_000;
    const attachButtonVisible = await probeOrFallback(false, () =>
      attachButton.isVisible({ timeout: attachButtonVisibilityTimeoutMilliseconds }),
    );

    const isAttachButtonHidden = !attachButtonVisible;
    if (isAttachButtonHidden) {
      throw new Error("Gemini file attachment controls are not available on this page.");
    }

    await attachButton.click();
    const fileUpload = this.page.locator(SELECTORS.attachmentInput).first();
    await fileUpload.waitFor({ state: "attached", timeout: CONTROL_WAIT_TIMEOUT_MILLISECONDS });
    await fileUpload.setInputFiles(paths);
  };

  private readModelFromTrigger = async (trigger: Locator): Promise<string> => {
    const visibleLabel = await probeOrFallback("", () => readVisibleCopy(trigger));
    const triggerLabel = cleanVisibleCopy(visibleLabel);
    const modelLine = triggerLabel.split("\n").find(isLikelyModelLabel);

    const hasModelLine = modelLine != null;
    if (hasModelLine) return modelLine;

    return this.readTriggerAriaLabel(trigger);
  };

  private readTriggerAriaLabel = async (trigger: Locator): Promise<string> => {
    const ariaLabel = await probeOrFallback(null, () => trigger.getAttribute("aria-label"));

    const isAriaLabelMissing = ariaLabel == null;
    if (isAriaLabelMissing) return GEMINI_BUTTON_LABEL;

    const isAriaLabelModel = isLikelyModelLabel(ariaLabel);
    if (isAriaLabelModel) return ariaLabel.trim();

    return GEMINI_BUTTON_LABEL;
  };

  private collectMenuModels = async (): Promise<ModelOption[]> => {
    const menuElements = this.page.locator(MENU_CHOICE_SELECTOR);
    const menuElementCount = await menuElements.count();
    const models: ModelOption[] = [];
    for (let index = 0; index < menuElementCount; index += 1) {
      const model = await this.readMenuElementModel(menuElements.nth(index));

      const hasModel = model != null;
      if (hasModel) models.push(model);
    }
    return models;
  };

  private readMenuElementModel = async (element: Locator): Promise<ModelOption | null> => {
    const visibleLabel = await probeOrFallback("", () => readVisibleCopy(element));
    const label = cleanVisibleCopy(visibleLabel);

    const isLabelEmpty = label === "";
    if (isLabelEmpty) return null;

    const isLabelModel = isLikelyModelLabel(label);
    if (!isLabelModel) return null;

    const ariaChecked = await probeOrFallback(null, () => element.getAttribute("aria-checked"));
    const ariaSelected = await probeOrFallback(null, () => element.getAttribute("aria-selected"));
    const selected = ariaChecked === "true" || ariaSelected === "true";
    return { id: readModelId(label), label, selected };
  };

  private readFirstVisible = async (selector: string): Promise<Locator | null> => {
    const matches = this.page.locator(selector);
    const matchCount = await matches.count();
    for (let index = 0; index < matchCount; index += 1) {
      const candidate = matches.nth(index);

      const isCandidateVisible = await probeOrFallback(false, () => candidate.isVisible());
      if (isCandidateVisible) return candidate;
    }
    return null;
  };

  private collectModelsFromOpenMenu = async (trigger: Locator): Promise<ModelOption[]> => {
    await probeOrFallback(null, () => trigger.click());
    await probeOrFallback(null, () =>
      this.page.waitForSelector(SELECTORS.openMenu, { timeout: MENU_WAIT_TIMEOUT_MILLISECONDS }),
    );

    const models = await this.collectMenuModels();

    await probeOrFallback(null, () => this.page.keyboard.press(ESCAPE_KEY));

    return models;
  };

  private clickModelMenuElement = async (label: string): Promise<void> => {
    const trigger = await this.readFirstVisible(SELECTORS.modelTrigger);

    const isTriggerMissing = trigger == null;
    if (isTriggerMissing) throw new Error("Gemini model picker is not available.");

    await trigger.click();
    await this.page.waitForSelector(SELECTORS.openMenu, {
      timeout: MENU_WAIT_TIMEOUT_MILLISECONDS,
    });
    await this.page.locator(MENU_CHOICE_SELECTOR).filter({ hasText: label }).first().click();
    await probeOrFallback(null, () => this.page.keyboard.press(ESCAPE_KEY));
  };

  private findModel = async (query: string): Promise<ModelOption> => {
    const models = await this.listAvailableModels();
    const normalizedQuery = query.trim().toLowerCase();
    const queryModelId = readModelId(normalizedQuery);

    function isQueryMatch(model: ModelOption): boolean {
      const isLabelMatch = model.label.toLowerCase().includes(normalizedQuery);
      if (isLabelMatch) return true;

      return model.id.includes(queryModelId);
    }

    const matchedModel = models.find(isQueryMatch);

    const isModelMissing = matchedModel == null;
    if (isModelMissing) throw new Error(`Model not found in Gemini picker: ${query}`);

    return matchedModel;
  };

  private isGuestSession = async (): Promise<boolean> => {
    const composer = this.page.locator(SELECTORS.promptInput).filter({ visible: true }).first();
    const promptFieldVisibilityTimeoutMilliseconds = 2500;
    const isComposerVisible = await probeOrFallback(false, () =>
      composer.isVisible({ timeout: promptFieldVisibilityTimeoutMilliseconds }),
    );
    if (isComposerVisible) return false;

    const signIn = this.page.locator(SELECTORS.signInButton).first();
    const signInVisibilityTimeoutMilliseconds = 1500;

    return probeOrFallback(true, () =>
      signIn.isVisible({ timeout: signInVisibilityTimeoutMilliseconds }),
    );
  };

  private fillComposerAndSend = async (composer: Locator, prompt: string): Promise<void> => {
    await composer.click();
    await composer.fill(prompt);
    await composer.dispatchEvent("input");
    await this.clickSendOrEnter();
  };

  private clickSendOrEnter = async (): Promise<void> => {
    const sendButton = this.page.locator(SELECTORS.sendButton).filter({ visible: true }).first();

    // The send button may never surface; then the Enter fallback runs unless a reply streams.
    const isSendButtonClicked = await probeOrFallback(false, async () => {
      await sendButton.waitFor({
        state: VISIBLE_WAIT_MODE,
        timeout: CONTROL_WAIT_TIMEOUT_MILLISECONDS,
      });
      await sendButton.click();
      return true;
    });
    if (isSendButtonClicked) return;

    // Pressing Enter mid-stream would either no-op or interrupt Gemini's reply, so hold until idle.
    const isStillStreamingLater = await isReplyGenerating(this.page, SELECTORS.streamingIndicator);
    if (isStillStreamingLater) return;

    await this.page.keyboard.press("Enter");
  };

  private isComposerCleared = async (): Promise<boolean> => {
    const maxComposerClearChecks = 10;

    for (let poll = 0; poll < maxComposerClearChecks; poll += 1) {
      const composerDraft = await this.readComposerDraft();

      const isComposerEmpty = composerDraft === "";
      if (isComposerEmpty) return true;

      await this.page.waitForTimeout(UI_SETTLE_MILLISECONDS);
    }
    return false;
  };

  private readComposerDraft = async (): Promise<string> => {
    return this.page.evaluate(() => {
      const editor = document.querySelector<HTMLElement>(
        "div.ql-editor, [contenteditable='true'][role='textbox']",
      );

      const isEditorMissing = editor === null;
      if (isEditorMissing) return "";

      // biome-ignore lint/performance/useDomNodeTextContent: the composer text must match what the user sees
      return editor.innerText.trim();
    });
  };

  private waitForInitialReply = async (parsedSettings: ParsedWaitSettings): Promise<void> => {
    const previousReply = parsedSettings.previousLastAssistantText ?? "";
    const hasPreviousCount = parsedSettings.previousAssistantCount != null;
    const hasPreviousReply = previousReply !== "";

    const hasPreviousReplyBaseline = hasPreviousCount || hasPreviousReply;
    if (hasPreviousReplyBaseline) {
      await this.waitForReplyAfterBaseline(parsedSettings);
      return;
    }

    await this.page.waitForSelector(SELECTORS.responseBlock, { timeout: parsedSettings.timeout });
  };

  private waitForReplyAfterBaseline = async (settings: ParsedWaitSettings): Promise<void> => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < settings.timeout) {
      const hasBaselineAdvanced = await this.isBaselineAdvanced(settings);
      if (hasBaselineAdvanced) return;

      const replyBaselinePollMilliseconds = 250;

      await this.page.waitForTimeout(replyBaselinePollMilliseconds);
    }
    throw new Error("Timed out waiting for Gemini to start a new response.");
  };

  private isBaselineAdvanced = async (settings: ParsedWaitSettings): Promise<boolean> => {
    const isStreamingIndicatorShown = await this.hasStreamingIndicator();
    if (isStreamingIndicatorShown) return true;

    const hasMoreAssistantTurns = await this.isAssistantCountAdvanced(settings);
    if (hasMoreAssistantTurns) return true;

    return this.isLastAssistantReplyAdvanced(settings);
  };

  private hasStreamingIndicator = async (): Promise<boolean> => {
    return probeOrFallback(false, () =>
      this.page.locator(SELECTORS.streamingIndicator).first().isVisible(),
    );
  };

  private isAssistantCountAdvanced = async (settings: ParsedWaitSettings): Promise<boolean> => {
    const previousAssistantCount = settings.previousAssistantCount;

    const isPreviousCountMissing = previousAssistantCount == null;
    if (isPreviousCountMissing) return false;

    const assistantCount = await this.countAssistantReplies();
    return assistantCount > previousAssistantCount;
  };

  private isLastAssistantReplyAdvanced = async (settings: ParsedWaitSettings): Promise<boolean> => {
    const previousReply = settings.previousLastAssistantText;

    const isPreviousMissing = previousReply == null;
    if (isPreviousMissing) return false;

    const isPreviousBlank = previousReply === "";
    if (isPreviousBlank) return false;

    const lastReply = await probeOrFallback("", () => this.captureLastReply());
    const cleanReply = cleanVisibleCopy(lastReply);

    const isLastEmpty = cleanReply === "";
    if (isLastEmpty) return false;

    return cleanReply !== previousReply;
  };

  private waitForStreamingEnd = async (startedAt: number, timeout: number): Promise<void> => {
    await probeOrFallback(null, async () => {
      const indicator = this.page.locator(SELECTORS.streamingIndicator).first();
      const streamingEndWaitTimeoutMilliseconds = 10_000;

      await indicator.waitFor({
        state: VISIBLE_WAIT_MODE,
        timeout: streamingEndWaitTimeoutMilliseconds,
      });
      await indicator.waitFor({
        state: "hidden",
        timeout: readRemainingTimeout(startedAt, timeout),
      });
    });
  };

  private waitForLastAssistantReplyStable = async (timeout: number): Promise<void> => {
    const startedAt = Date.now();
    let lastReply = "";
    let stableSince = Date.now();
    while (Date.now() - startedAt < timeout) {
      const snapshot = await this.readStabilitySnapshot();

      const hasSnapshotChanged = snapshot.text !== lastReply;
      if (hasSnapshotChanged) {
        lastReply = snapshot.text;
        stableSince = Date.now();
      }

      const isTurnDone = isTurnSettled({
        hasText: snapshot.text !== "",
        isTransientText: isTransientAssistantReply(snapshot.text),
        streaming: snapshot.streaming,
        stableForMilliseconds: Date.now() - stableSince,
      });
      if (isTurnDone) return;

      await this.page.waitForTimeout(UI_SETTLE_MILLISECONDS);
    }
    throw new Error("Timed out waiting for Gemini response to settle.");
  };

  private readStabilitySnapshot = async (): Promise<{ text: string; streaming: boolean }> => {
    const lastReply = await probeOrFallback("", () => this.captureLastReply());
    const displayReply = cleanVisibleCopy(lastReply);
    const streaming = await this.hasStreamingIndicator();
    return { text: displayReply, streaming };
  };
}
