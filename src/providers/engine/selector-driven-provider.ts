import type { Locator, Page } from "playwright";
import { DEFAULT_ASK_TIMEOUT_SECONDS } from "@/app-defaults.ts";
import type {
  ConnectorSetupReport,
  ConnectorSetupSettings,
  ModelOption,
} from "@/connector-types.ts";
import { type BridgeProviderId, PROVIDER_SETTINGS } from "@/provider-settings.ts";
import { setupMcpConnectorInClaude } from "@/providers/claude-connector.ts";
import type {
  BrowserProvider,
  ProviderProfile,
  ReplyWaitSettings,
} from "@/providers/engine/browser-provider.ts";
import {
  logUnlessElementMissing,
  probeOrFallback,
  readVisibleCopy,
} from "@/providers/engine/browser-provider.ts";
import { ESCAPE_KEY, HTML_PARSED_WAIT, readFirstLine } from "@/providers/engine/page-probes.ts";
import { createStallReloadWatchdog } from "@/providers/engine/render-stall-watchdog.ts";
import { isReplyGenerating, waitForReplyIdle } from "@/providers/engine/streaming-guard.ts";
import { setupMcpConnectorInGrok } from "@/providers/grok-connector.ts";

const CONTROL_WAIT_TIMEOUT_MILLISECONDS = 5_000;

const QUICK_SETTLE_MILLISECONDS = 400;

const CLICK_TIMEOUT_MILLISECONDS = 4_000;

type ConnectorSetup = (
  page: Page,
  url: string,
  settings?: ConnectorSetupSettings,
) => Promise<ConnectorSetupReport>;

const CONNECTOR_SETUP: Partial<Record<BridgeProviderId, ConnectorSetup>> = {
  claude: setupMcpConnectorInClaude,
  grok: setupMcpConnectorInGrok,
};

function readReplyWaitSettings(
  waitSettings: number | ReplyWaitSettings | undefined,
): ReplyWaitSettings {
  const isWaitTypeNumber = typeof waitSettings === "number";
  if (isWaitTypeNumber) {
    return { timeout: waitSettings };
  }

  const isWaitMissing = waitSettings == null;
  if (isWaitMissing) {
    return {};
  }

  return waitSettings;
}

function readWaitTimeoutMilliseconds(waitSettings: ReplyWaitSettings): number {
  const actionTimeoutMilliseconds = 1000;

  return waitSettings.timeout ?? DEFAULT_ASK_TIMEOUT_SECONDS * actionTimeoutMilliseconds;
}

function readPreviousAssistantCount(waitSettings: ReplyWaitSettings): number {
  return waitSettings.previousAssistantCount ?? 0;
}

function readPreviousLastAssistantReply(waitSettings: ReplyWaitSettings): string {
  return waitSettings.previousLastAssistantText ?? "";
}

function stopControlSelector(stopSelector: string | undefined): string {
  const isStopSelectorMissing = stopSelector == null;
  if (isStopSelectorMissing) {
    return "";
  }

  return stopSelector;
}

function createSelectorProfile(providerId: BridgeProviderId) {
  const settings = PROVIDER_SETTINGS[providerId];
  return {
    id: providerId,
    origin: settings.origin,
    defaultUrl: settings.defaultUrl,
    defaultModel: settings.defaultModel,
    displayName: settings.displayName,
    composerSelector: settings.selectors.composer,
    supportsMcpConnector: settings.supportsMcpConnector,
  } satisfies ProviderProfile;
}

export type SelectorDrivenProfile = ReturnType<typeof createSelectorProfile>;

export const claudeProfile = createSelectorProfile("claude");

export const deepseekProfile = createSelectorProfile("deepseek");

export const grokProfile = createSelectorProfile("grok");

export const perplexityProfile = createSelectorProfile("perplexity");

export const duckProfile = createSelectorProfile("duck");

function createSelectorDrivenMethods(providerId: BridgeProviderId) {
  const profile = { id: providerId, ...PROVIDER_SETTINGS[providerId] };
  const connectorSetup = CONNECTOR_SETUP[providerId];
  const { id, displayName, defaultUrl, defaultModel, origin } = profile;
  const composerSelector = profile.selectors.composer;
  const stopSelector = stopControlSelector(profile.selectors.stop);

  async function assertSignedIn(page: Page): Promise<void> {
    const signedOutSelector = profile.selectors.signedOut;

    const hasSignedOutSelector = signedOutSelector != null;
    if (hasSignedOutSelector) {
      const signedOutCount = await probeOrFallback(0, () =>
        page.locator(signedOutSelector).count(),
      );

      const isSignedOutFound = signedOutCount > 0;
      if (isSignedOutFound) {
        throw new Error(
          `${displayName}: not signed in. Run \`bridge chrome start --provider ${id}\` and sign in if needed.`,
        );
      }
    }

    const composerCount = await probeOrFallback(0, () => page.locator(composerSelector).count());

    const isComposerMissing = composerCount === 0;
    if (isComposerMissing) {
      throw new Error(
        `${displayName}: composer not found — the page UI may have changed, or you are not signed in.`,
      );
    }
  }

  async function injectPrompt(page: Page, prompt: string): Promise<void> {
    const composer = page.locator(composerSelector).filter({ visible: true }).first();
    const maxPromptInjectAttempts = 3;

    for (let attempt = 0; attempt < maxPromptInjectAttempts; attempt += 1) {
      // Wait out any in-flight response first so a retry never sends on top of one.
      await waitForReplyIdle(page, stopSelector);
      await composer.click();
      try {
        await composer.fill(prompt);
      } catch (error) {
        // Some composers reject fill but accept typed keys, so typing is the fallback.
        logUnlessElementMissing(error);
        await composer.type(prompt);
      }
      await submitPrompt(page);

      const hasComposerCleared = await isComposerCleared(page);
      if (hasComposerCleared) return;

      // An active stream means the prompt landed even if the composer was slow to empty.
      const isStillStreaming = await isReplyGenerating(page, stopSelector);
      if (isStillStreaming) return;
    }
    throw new Error(`${displayName}: composer never cleared after 3 send attempts.`);
  }

  async function submitPrompt(page: Page): Promise<void> {
    const sendSelector = profile.selectors.send;

    const hasSendSelector = sendSelector != null;
    if (hasSendSelector) {
      const isSendClicked = await probeOrFallback(false, async () => {
        await page
          .locator(sendSelector)
          .filter({ visible: true })
          .first()
          .click({ timeout: CLICK_TIMEOUT_MILLISECONDS });
        return true;
      });

      if (isSendClicked) return;
    }

    // Only press Enter when idle — doing it mid-stream risks interrupting the response.
    const isStillStreamingLater = await isReplyGenerating(page, stopSelector);
    if (isStillStreamingLater) return;

    await probeOrFallback(null, () => page.keyboard.press("Enter"));
  }

  // An input with no value (a contenteditable) falls back to the text the user sees.
  async function readComposerDraft(composer: Locator): Promise<string> {
    const composerDraft = await probeOrFallback(null, () => composer.inputValue());

    const hasComposerDraft = composerDraft != null;
    if (hasComposerDraft) return composerDraft;

    return probeOrFallback("", () => readVisibleCopy(composer));
  }

  async function isComposerCleared(page: Page): Promise<boolean> {
    const composer = page.locator(composerSelector).filter({ visible: true }).first();
    const maxComposerClearChecks = 10;

    for (let poll = 0; poll < maxComposerClearChecks; poll += 1) {
      const composerDraft = await readComposerDraft(composer);

      const isComposerDraftEmpty = composerDraft.trim() === "";
      if (isComposerDraftEmpty) return true;

      await probeOrFallback(null, () => page.waitForTimeout(QUICK_SETTLE_MILLISECONDS));
    }
    return false;
  }

  async function waitForReply(
    page: Page,
    waitSettings?: number | ReplyWaitSettings,
  ): Promise<void> {
    const replyWaitSettings = readReplyWaitSettings(waitSettings);
    const timeoutMilliseconds = readWaitTimeoutMilliseconds(replyWaitSettings);
    const assistantCountBefore = readPreviousAssistantCount(replyWaitSettings);
    const lastAssistantReplyBefore = readPreviousLastAssistantReply(replyWaitSettings);
    // A count increase covers most chats; a text change covers UIs that edit the last reply in place.
    await probeOrFallback(null, () =>
      page.waitForFunction(
        (waitArguments) => {
          const nodes = document.querySelectorAll(waitArguments.assistantSelector);

          const hasNewNodes = nodes.length > waitArguments.previousCount;
          if (hasNewNodes) return true;

          const isPreviousEmpty = waitArguments.previousText.length === 0;
          if (isPreviousEmpty) return false;

          const lastNode = nodes.item(nodes.length - 1);

          const isLastNodeUnreadable = lastNode == null || lastNode.textContent == null;
          if (isLastNodeUnreadable) return false;

          const assistantReply = lastNode.textContent.trim();
          return (
            nodes.length > 0 &&
            assistantReply.length > 0 &&
            assistantReply !== waitArguments.previousText
          );
        },
        {
          assistantSelector: profile.selectors.assistant,
          previousCount: assistantCountBefore,
          previousText: lastAssistantReplyBefore,
        },
        { timeout: timeoutMilliseconds },
      ),
    );
    await waitForStreamIdle(page, timeoutMilliseconds);
  }

  // Reloads when the reply stays absent past the stall threshold, so a stuck render re-syncs.
  async function waitForStreamIdle(page: Page, budgetMilliseconds: number): Promise<void> {
    const deadline = Date.now() + budgetMilliseconds;
    const watchdog = createStallReloadWatchdog({
      waitAfterReload: (target) => waitForComposerReady(target),
      onReload: (reloadCount) =>
        process.stderr.write(
          `[bridge] ${displayName} render stalled — reloaded tab (reload ${reloadCount}).\n`,
        ),
    });
    let previousAssistantReply = "";
    while (Date.now() < deadline) {
      const currentAssistantReply = await probeOrFallback("", () => captureLastReply(page));

      // Stable text counts as final only once streaming ends, since a stable label can still be streaming.
      const stillStreaming = await isReplyGenerating(page, stopSelector);

      const isAssistantReplyStable =
        currentAssistantReply.length > 0 &&
        currentAssistantReply === previousAssistantReply &&
        !stillStreaming;
      if (isAssistantReplyStable) {
        return;
      }

      const hasAssistantReplyChanged = currentAssistantReply !== previousAssistantReply;
      const isNotStillStreaming = !stillStreaming;
      const isStalledWhileIdle =
        !hasAssistantReplyChanged && isNotStillStreaming && (await watchdog.reloadIfStalled(page));

      if (hasAssistantReplyChanged) {
        previousAssistantReply = currentAssistantReply;
        watchdog.noteProgress();
      } else if (isStalledWhileIdle) {
        previousAssistantReply = "";
        continue;
      }

      await probeOrFallback(null, () => page.waitForTimeout(QUICK_SETTLE_MILLISECONDS));
    }
  }

  async function waitForComposerReady(page: Page): Promise<void> {
    const waitTimeoutMilliseconds = 15_000;

    await probeOrFallback(null, () =>
      page.waitForSelector(composerSelector, { timeout: waitTimeoutMilliseconds }),
    );
  }

  async function captureLastReply(page: Page): Promise<string> {
    const lastAssistant = page.locator(profile.selectors.assistant).last();
    const lastAssistantReply = await probeOrFallback("", () => readVisibleCopy(lastAssistant));
    return lastAssistantReply.trim();
  }

  async function countAssistantReplies(page: Page): Promise<number> {
    return probeOrFallback(0, () => page.locator(profile.selectors.assistant).count());
  }

  async function captureAllMessages(page: Page): Promise<Array<{ role: string; content: string }>> {
    const assistantReplies = await probeOrFallback([], () =>
      page.locator(profile.selectors.assistant).allInnerTexts(),
    );
    const assistantMessages = assistantReplies.map((reply) => ({
      role: "assistant",
      content: reply.trim(),
    }));
    const userSelector = profile.selectors.user;

    const isUserSelectorMissing = userSelector == null;
    if (isUserSelectorMissing) return assistantMessages;

    const userPrompts = await probeOrFallback([], () => page.locator(userSelector).allInnerTexts());
    const userMessages = userPrompts.map((userPrompt) => ({
      role: "user",
      content: userPrompt.trim(),
    }));
    return [...userMessages, ...assistantMessages];
  }

  async function readSidebarConversations(
    page: Page,
  ): Promise<Array<{ id: string; title: string; url: string }>> {
    const sidebarElementSelector = profile.selectors.sidebarItem;

    const isSidebarSelectorMissing = sidebarElementSelector == null;
    if (isSidebarSelectorMissing) return [];

    const links = page.locator(sidebarElementSelector);
    const maxLinkCount = 40;

    const linkCount = await probeOrFallback(0, () => links.count());
    const total = Math.min(linkCount, maxLinkCount);
    const baseUrl = `https://${origin}`;
    const conversations: Array<{ id: string; title: string; url: string }> = [];
    for (let index = 0; index < total; index += 1) {
      const link = links.nth(index);

      const href = await probeOrFallback(null, () => link.getAttribute("href"));

      const isHrefBlank = href === null || href.length === 0;
      if (isHrefBlank) continue;

      const conversationUrl = new URL(href, baseUrl).toString();
      const title = readFirstLine(await probeOrFallback("", () => readVisibleCopy(link)));
      const pathSegment = href.split("/").filter(Boolean).pop();
      let conversationId = href;

      const hasPathSegment = pathSegment != null;
      if (hasPathSegment) {
        conversationId = pathSegment;
      }

      let conversationTitle = conversationId;

      const hasTitle = title.length > 0;
      if (hasTitle) {
        conversationTitle = title;
      }

      conversations.push({
        id: conversationId,
        title: conversationTitle,
        url: conversationUrl,
      });
    }
    return conversations;
  }

  async function navigateToConversation(page: Page, url: string): Promise<void> {
    await page.goto(url, { waitUntil: HTML_PARSED_WAIT });
  }

  async function startNewConversation(page: Page): Promise<void> {
    const newChatSelector = profile.selectors.newChat;

    const hasNewChatSelector = newChatSelector != null;
    if (hasNewChatSelector) {
      const isNewChatClicked = await probeOrFallback(false, async () => {
        await page.locator(newChatSelector).first().click({ timeout: CLICK_TIMEOUT_MILLISECONDS });
        return true;
      });

      if (isNewChatClicked) {
        await probeOrFallback(null, () => page.waitForTimeout(QUICK_SETTLE_MILLISECONDS));
        return;
      }
    }

    await page.goto(defaultUrl, { waitUntil: HTML_PARSED_WAIT });
  }

  async function detectCurrentModel(page: Page): Promise<string> {
    const modelTriggerSelector = profile.selectors.modelTrigger;

    const isModelTriggerSelectorMissing = modelTriggerSelector == null;
    if (isModelTriggerSelectorMissing) return defaultModel;

    const triggerLabel = await probeOrFallback("", () =>
      readVisibleCopy(page.locator(modelTriggerSelector).first()),
    );

    const modelLabel = readFirstLine(triggerLabel);

    const isModelLabelUsable = modelLabel.length > 0 && isLikelyModelLabel(modelLabel);
    if (isModelLabelUsable) {
      return modelLabel;
    }

    return defaultModel;
  }

  async function listAvailableModels(page: Page): Promise<ModelOption[]> {
    const modelOptionSelector = profile.selectors.modelOption;

    const isModelOptionSelectorMissing = modelOptionSelector == null;
    if (isModelOptionSelectorMissing) return [];

    const isModelPickerNotOpened = !(await openModelPicker(page));
    if (isModelPickerNotOpened) return [];

    const modelChoices = page.locator(modelOptionSelector);
    const maxModelChoiceCount = 30;

    const modelChoiceCount = await probeOrFallback(0, () => modelChoices.count());
    const total = Math.min(modelChoiceCount, maxModelChoiceCount);
    const models: ModelOption[] = [];
    for (let index = 0; index < total; index += 1) {
      const option = modelChoices.nth(index);
      const label = readFirstLine(await probeOrFallback("", () => readVisibleCopy(option)));

      const isLabelEmpty = label.length === 0;
      if (isLabelEmpty) continue;

      const ariaChecked = await probeOrFallback(null, () => option.getAttribute("aria-checked"));
      const ariaSelected = await probeOrFallback(null, () => option.getAttribute("aria-selected"));
      models.push({
        id: label,
        label,
        selected: ariaChecked === "true" || ariaSelected === "true",
      });
    }
    await probeOrFallback(null, () => page.keyboard.press(ESCAPE_KEY));
    return models;
  }

  async function selectModel(page: Page, query: string): Promise<string> {
    const modelOptionSelector = profile.selectors.modelOption;

    const isModelOptionSelectorMissing = modelOptionSelector == null;
    if (isModelOptionSelectorMissing) return defaultModel;

    const isModelPickerStillClosed = !(await openModelPicker(page));
    if (isModelPickerStillClosed) return defaultModel;

    const matchingOption = page.locator(modelOptionSelector).filter({ hasText: query }).first();

    const optionClicked = await probeOrFallback(false, async () => {
      await matchingOption.click({ timeout: CLICK_TIMEOUT_MILLISECONDS });
      return true;
    });

    const isNotOptionClicked = !optionClicked;
    if (isNotOptionClicked) {
      await probeOrFallback(null, () => page.keyboard.press(ESCAPE_KEY));
      throw new Error(`${displayName}: no model matching "${query}".`);
    }

    const modelSelectSettleMilliseconds = 600;

    await probeOrFallback(null, () => page.waitForTimeout(modelSelectSettleMilliseconds));
    return detectCurrentModel(page);
  }

  async function openModelPicker(page: Page): Promise<boolean> {
    const modelTriggerSelector = profile.selectors.modelTrigger;

    const isModelTriggerSelectorMissing = modelTriggerSelector == null;
    if (isModelTriggerSelectorMissing) return false;

    const isPickerOpened = await probeOrFallback(false, async () => {
      await page
        .locator(modelTriggerSelector)
        .first()
        .click({ timeout: CONTROL_WAIT_TIMEOUT_MILLISECONDS });
      return true;
    });

    if (isPickerOpened) {
      const modelPickerSettleMilliseconds = 500;

      await probeOrFallback(null, () => page.waitForTimeout(modelPickerSettleMilliseconds));
    }

    return isPickerOpened;
  }

  async function rewindLastUserPrompt(_page: Page): Promise<void> {
    throw new Error(`${displayName}: rewinding the last prompt is not supported.`);
  }

  async function stopGenerating(
    page: Page,
    timeout = CONTROL_WAIT_TIMEOUT_MILLISECONDS,
  ): Promise<boolean> {
    const stopSelector = profile.selectors.stop;

    const isProfileSelectorsStopMissing = stopSelector == null;
    if (isProfileSelectorsStopMissing) return false;

    const stopControl = page.locator(stopSelector).first();

    const isStopVisible = await probeOrFallback(false, () => stopControl.isVisible({ timeout }));

    if (isStopVisible) {
      await probeOrFallback(null, () => stopControl.click({ timeout }));
      return true;
    }

    return false;
  }

  async function attachFilesToPrompt(page: Page, paths: string[]): Promise<void> {
    const attachSelector = profile.selectors.attach;

    const isAttachSelectorMissing = attachSelector == null;
    if (isAttachSelectorMissing) {
      throw new Error(`${displayName}: attaching files is not supported.`);
    }

    await page.locator(attachSelector).first().setInputFiles(paths);
  }

  async function setupMcpConnector(
    page: Page,
    url: string,
    setupSettings?: ConnectorSetupSettings,
  ): Promise<ConnectorSetupReport> {
    const isConnectorSetupMissing = connectorSetup == null;
    if (isConnectorSetupMissing) {
      return {
        connectorUrl: url,
        completed: false,
        steps: [],
        warnings: [`${displayName} has no MCP connector setup wired.`],
      };
    }

    return connectorSetup(page, url, setupSettings);
  }

  function isLikelyModelLabel(label: string): boolean {
    const trimmed = label.trim().toLowerCase();

    const isTrimmedEmpty = trimmed.length === 0;
    if (isTrimmedEmpty) return false;

    const maxModelLabelLength = 40;

    const isTrimmedTooLong = trimmed.length > maxModelLabelLength;
    if (isTrimmedTooLong) return false;

    return [
      "gpt",
      "claude",
      "gemini",
      "grok",
      "deepseek",
      "sonar",
      "opus",
      "sonnet",
      "haiku",
      "reasoner",
      "flash",
    ].some((keyword) => trimmed.includes(keyword));
  }

  return {
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
    setupMcpConnector,
  };
}

export class SelectorDrivenProvider implements BrowserProvider {
  private readonly methods: ReturnType<typeof createSelectorDrivenMethods>;

  constructor(
    readonly profile: SelectorDrivenProfile,
    private readonly page: Page,
  ) {
    this.methods = createSelectorDrivenMethods(profile.id);
  }

  assertSignedIn: BrowserProvider["assertSignedIn"] = () => this.methods.assertSignedIn(this.page);

  injectPrompt: BrowserProvider["injectPrompt"] = (prompt) =>
    this.methods.injectPrompt(this.page, prompt);

  waitForReply: BrowserProvider["waitForReply"] = (waitSettings) =>
    this.methods.waitForReply(this.page, waitSettings);

  captureLastReply: BrowserProvider["captureLastReply"] = () =>
    this.methods.captureLastReply(this.page);

  countAssistantReplies: BrowserProvider["countAssistantReplies"] = () =>
    this.methods.countAssistantReplies(this.page);

  captureAllMessages: BrowserProvider["captureAllMessages"] = () =>
    this.methods.captureAllMessages(this.page);

  readSidebarConversations: BrowserProvider["readSidebarConversations"] = () =>
    this.methods.readSidebarConversations(this.page);

  navigateToConversation: BrowserProvider["navigateToConversation"] = (url) =>
    this.methods.navigateToConversation(this.page, url);

  newConversation: BrowserProvider["newConversation"] = () =>
    this.methods.newConversation(this.page);

  detectCurrentModel: BrowserProvider["detectCurrentModel"] = () =>
    this.methods.detectCurrentModel(this.page);

  listAvailableModels: BrowserProvider["listAvailableModels"] = () =>
    this.methods.listAvailableModels(this.page);

  selectModel: BrowserProvider["selectModel"] = (query) =>
    this.methods.selectModel(this.page, query);

  rewindLastUserPrompt: BrowserProvider["rewindLastUserPrompt"] = () =>
    this.methods.rewindLastUserPrompt(this.page);

  stopGenerating: BrowserProvider["stopGenerating"] = (timeout) =>
    this.methods.stopGenerating(this.page, timeout);

  attachFilesToPrompt: BrowserProvider["attachFilesToPrompt"] = (paths) =>
    this.methods.attachFilesToPrompt(this.page, paths);

  isLikelyModelLabel: BrowserProvider["isLikelyModelLabel"] = (label) =>
    this.methods.isLikelyModelLabel(label);

  setupMcpConnector: NonNullable<BrowserProvider["setupMcpConnector"]> = (url, setupSettings) =>
    this.methods.setupMcpConnector(this.page, url, setupSettings);
}
