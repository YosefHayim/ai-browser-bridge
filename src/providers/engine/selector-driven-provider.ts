import type { Locator, Page } from "playwright";
import type {
  ConnectorSetupReport,
  ConnectorSetupSettings,
  ModelOption,
} from "@/connector-types.ts";
import { PROVIDER_SETTINGS } from "@/provider-settings.ts";
import type { BrowserProvider, ReplyWaitSettings } from "@/providers/engine/browser-provider.ts";
import {
  logUnlessElementMissing,
  probeOrFallback,
  readVisibleCopy,
} from "@/providers/engine/browser-provider.ts";
import { ESCAPE_KEY, HTML_PARSED_WAIT, readFirstLine } from "@/providers/engine/page-probes.ts";
import { createStallReloadWatchdog } from "@/providers/engine/render-stall-watchdog.ts";
import { CONNECTOR_SETUP } from "@/providers/engine/selector-connector-setup.ts";
import type { SelectorDrivenProfile } from "@/providers/engine/selector-profiles.ts";
import {
  readPreviousAssistantCount,
  readPreviousLastAssistantReply,
  readReplyWaitSettings,
  readWaitTimeoutMilliseconds,
  stopControlSelector,
} from "@/providers/engine/selector-wait-settings.ts";
import { isReplyGenerating, waitForReplyIdle } from "@/providers/engine/streaming-guard.ts";

const CONTROL_WAIT_TIMEOUT_MILLISECONDS = 5_000;

const QUICK_SETTLE_MILLISECONDS = 400;

const CLICK_TIMEOUT_MILLISECONDS = 4_000;

export class SelectorDrivenProvider implements BrowserProvider {
  private readonly selectors;

  private readonly stopSelector: string;

  private readonly connectorSetup;

  constructor(
    readonly profile: SelectorDrivenProfile,
    private readonly page: Page,
  ) {
    const settings = PROVIDER_SETTINGS[profile.id];
    this.selectors = settings.selectors;
    this.stopSelector = stopControlSelector(settings.selectors.stop);
    this.connectorSetup = CONNECTOR_SETUP[profile.id];
  }

  assertSignedIn = async (): Promise<void> => {
    const signedOutSelector = this.selectors.signedOut;

    const hasSignedOutSelector = signedOutSelector != null;
    if (hasSignedOutSelector) {
      const signedOutCount = await probeOrFallback(0, () =>
        this.page.locator(signedOutSelector).count(),
      );

      const isSignedOutFound = signedOutCount > 0;
      if (isSignedOutFound) {
        throw new Error(
          `${this.profile.displayName}: not signed in. Run \`bridge chrome start --provider ${this.profile.id}\` and sign in if needed.`,
        );
      }
    }

    const composerCount = await probeOrFallback(0, () =>
      this.page.locator(this.profile.composerSelector).count(),
    );

    const isComposerMissing = composerCount === 0;
    if (isComposerMissing) {
      throw new Error(
        `${this.profile.displayName}: composer not found — the page UI may have changed, or you are not signed in.`,
      );
    }
  };

  injectPrompt = async (prompt: string): Promise<void> => {
    const composer = this.page
      .locator(this.profile.composerSelector)
      .filter({ visible: true })
      .first();
    const maxPromptInjectAttempts = 3;

    for (let attempt = 0; attempt < maxPromptInjectAttempts; attempt += 1) {
      // Wait out any in-flight response first so a retry never sends on top of one.
      await waitForReplyIdle(this.page, this.stopSelector);
      await composer.click();
      try {
        await composer.fill(prompt);
      } catch (error) {
        // Some composers reject fill but accept typed keys, so typing is the fallback.
        logUnlessElementMissing(error);
        await composer.pressSequentially(prompt);
      }
      await this.submitPrompt();

      const hasComposerCleared = await this.isComposerCleared();
      if (hasComposerCleared) return;

      // An active stream means the prompt landed even if the composer was slow to empty.
      const isStillStreaming = await isReplyGenerating(this.page, this.stopSelector);
      if (isStillStreaming) return;
    }
    throw new Error(`${this.profile.displayName}: composer never cleared after 3 send attempts.`);
  };

  private submitPrompt = async (): Promise<void> => {
    const sendSelector = this.selectors.send;

    const hasSendSelector = sendSelector != null;
    if (hasSendSelector) {
      const isSendClicked = await probeOrFallback(false, async () => {
        await this.page
          .locator(sendSelector)
          .filter({ visible: true })
          .first()
          .click({ timeout: CLICK_TIMEOUT_MILLISECONDS });
        return true;
      });

      if (isSendClicked) return;
    }

    // Only press Enter when idle — doing it mid-stream risks interrupting the response.
    const isStillStreamingLater = await isReplyGenerating(this.page, this.stopSelector);
    if (isStillStreamingLater) return;

    await probeOrFallback(null, () => this.page.keyboard.press("Enter"));
  };

  // An input with no value (a contenteditable) falls back to the text the user sees.
  private readComposerDraft = async (composer: Locator): Promise<string> => {
    const composerDraft = await probeOrFallback(null, () => composer.inputValue());

    const hasComposerDraft = composerDraft != null;
    if (hasComposerDraft) return composerDraft;

    return probeOrFallback("", () => readVisibleCopy(composer));
  };

  private isComposerCleared = async (): Promise<boolean> => {
    const composer = this.page
      .locator(this.profile.composerSelector)
      .filter({ visible: true })
      .first();
    const maxComposerClearChecks = 10;

    for (let poll = 0; poll < maxComposerClearChecks; poll += 1) {
      const composerDraft = await this.readComposerDraft(composer);

      const isComposerDraftEmpty = composerDraft.trim() === "";
      if (isComposerDraftEmpty) return true;

      await probeOrFallback(null, () => this.page.waitForTimeout(QUICK_SETTLE_MILLISECONDS));
    }
    return false;
  };

  waitForReply = async (waitSettings?: number | ReplyWaitSettings): Promise<void> => {
    const replyWaitSettings = readReplyWaitSettings(waitSettings);
    const timeoutMilliseconds = readWaitTimeoutMilliseconds(replyWaitSettings);
    const assistantCountBefore = readPreviousAssistantCount(replyWaitSettings);
    const lastAssistantReplyBefore = readPreviousLastAssistantReply(replyWaitSettings);
    // A count increase covers most chats; a text change covers UIs that edit the last reply in place.
    await probeOrFallback(null, () =>
      this.page.waitForFunction(
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
          assistantSelector: this.selectors.assistant,
          previousCount: assistantCountBefore,
          previousText: lastAssistantReplyBefore,
        },
        { timeout: timeoutMilliseconds },
      ),
    );
    await this.waitForStreamIdle(timeoutMilliseconds);
  };

  // Reloads when the reply stays absent past the stall threshold, so a stuck render re-syncs.
  private waitForStreamIdle = async (budgetMilliseconds: number): Promise<void> => {
    const deadline = Date.now() + budgetMilliseconds;
    const watchdog = createStallReloadWatchdog({
      waitAfterReload: this.waitForComposerReady,
      onReload: (reloadCount) =>
        process.stderr.write(
          `[bridge] ${this.profile.displayName} render stalled — reloaded tab (reload ${reloadCount}).\n`,
        ),
    });
    let previousAssistantReply = "";
    while (Date.now() < deadline) {
      const currentAssistantReply = await probeOrFallback("", () => this.captureLastReply());

      // Stable text counts as final only once streaming ends, since a stable label can still be streaming.
      const stillStreaming = await isReplyGenerating(this.page, this.stopSelector);

      const hasReplyText = currentAssistantReply.length > 0;
      const isReplyUnchanged = currentAssistantReply === previousAssistantReply;
      const isAssistantReplyStable = [hasReplyText, isReplyUnchanged, !stillStreaming].every(
        Boolean,
      );
      if (isAssistantReplyStable) return;

      const hasAssistantReplyChanged = !isReplyUnchanged;
      if (hasAssistantReplyChanged) {
        previousAssistantReply = currentAssistantReply;
        watchdog.noteProgress();
        await probeOrFallback(null, () => this.page.waitForTimeout(QUICK_SETTLE_MILLISECONDS));
        continue;
      }

      const isStalledWhileIdle = stillStreaming ? false : await watchdog.reloadIfStalled(this.page);
      if (isStalledWhileIdle) {
        previousAssistantReply = "";
        continue;
      }

      await probeOrFallback(null, () => this.page.waitForTimeout(QUICK_SETTLE_MILLISECONDS));
    }
  };

  private waitForComposerReady = async (): Promise<void> => {
    const waitTimeoutMilliseconds = 15_000;

    await probeOrFallback(null, () =>
      this.page.waitForSelector(this.profile.composerSelector, {
        timeout: waitTimeoutMilliseconds,
      }),
    );
  };

  captureLastReply = async (): Promise<string> => {
    const lastAssistant = this.page.locator(this.selectors.assistant).last();
    const lastAssistantReply = await probeOrFallback("", () => readVisibleCopy(lastAssistant));
    return lastAssistantReply.trim();
  };

  countAssistantReplies = async (): Promise<number> => {
    return probeOrFallback(0, () => this.page.locator(this.selectors.assistant).count());
  };

  captureAllMessages = async (): Promise<Array<{ role: string; content: string }>> => {
    const assistantReplies = await probeOrFallback([], () =>
      this.page.locator(this.selectors.assistant).allInnerTexts(),
    );
    const assistantMessages = assistantReplies.map((reply) => ({
      role: "assistant",
      content: reply.trim(),
    }));
    const userSelector = this.selectors.user;

    const isUserSelectorMissing = userSelector == null;
    if (isUserSelectorMissing) return assistantMessages;

    const userPrompts = await probeOrFallback([], () =>
      this.page.locator(userSelector).allInnerTexts(),
    );
    const userMessages = userPrompts.map((userPrompt) => ({
      role: "user",
      content: userPrompt.trim(),
    }));
    return [...userMessages, ...assistantMessages];
  };

  readSidebarConversations = async (): Promise<
    Array<{ id: string; title: string; url: string }>
  > => {
    const sidebarElementSelector = this.selectors.sidebarItem;

    const isSidebarSelectorMissing = sidebarElementSelector == null;
    if (isSidebarSelectorMissing) return [];

    const links = this.page.locator(sidebarElementSelector);
    const maxLinkCount = 40;

    const linkCount = await probeOrFallback(0, () => links.count());
    const total = Math.min(linkCount, maxLinkCount);
    const baseUrl = `https://${this.profile.origin}`;
    const conversations: Array<{ id: string; title: string; url: string }> = [];
    for (let index = 0; index < total; index += 1) {
      const link = links.nth(index);

      const href = await probeOrFallback(null, () => link.getAttribute("href"));

      const isHrefBlank = href === null || href.length === 0;
      if (isHrefBlank) continue;

      const conversationUrl = new URL(href, baseUrl).toString();
      const linkCopy = await probeOrFallback("", () => readVisibleCopy(link));
      const title = readFirstLine(linkCopy);
      const pathSegment = href.split("/").filter(Boolean).pop();
      const conversationId = pathSegment ?? href;
      const conversationTitle = title.length > 0 ? title : conversationId;

      conversations.push({
        id: conversationId,
        title: conversationTitle,
        url: conversationUrl,
      });
    }
    return conversations;
  };

  navigateToConversation = async (url: string): Promise<void> => {
    await this.page.goto(url, { waitUntil: HTML_PARSED_WAIT });
  };

  newConversation = async (): Promise<void> => {
    const newChatSelector = this.selectors.newChat;

    const hasNewChatSelector = newChatSelector != null;
    if (hasNewChatSelector) {
      const isNewChatClicked = await probeOrFallback(false, async () => {
        await this.page
          .locator(newChatSelector)
          .first()
          .click({ timeout: CLICK_TIMEOUT_MILLISECONDS });
        return true;
      });

      if (isNewChatClicked) {
        await probeOrFallback(null, () => this.page.waitForTimeout(QUICK_SETTLE_MILLISECONDS));
        return;
      }
    }

    await this.page.goto(this.profile.defaultUrl, { waitUntil: HTML_PARSED_WAIT });
  };

  detectCurrentModel = async (): Promise<string> => {
    const modelTriggerSelector = this.selectors.modelTrigger;

    const isModelTriggerSelectorMissing = modelTriggerSelector == null;
    if (isModelTriggerSelectorMissing) return this.profile.defaultModel;

    const triggerLabel = await probeOrFallback("", () =>
      readVisibleCopy(this.page.locator(modelTriggerSelector).first()),
    );

    const modelLabel = readFirstLine(triggerLabel);

    const isModelLabelUsable = modelLabel.length > 0 && this.isLikelyModelLabel(modelLabel);
    if (isModelLabelUsable) {
      return modelLabel;
    }

    return this.profile.defaultModel;
  };

  listAvailableModels = async (): Promise<ModelOption[]> => {
    const modelOptionSelector = this.selectors.modelOption;

    const isModelOptionSelectorMissing = modelOptionSelector == null;
    if (isModelOptionSelectorMissing) return [];

    const isModelPickerNotOpened = !(await this.openModelPicker());
    if (isModelPickerNotOpened) return [];

    const modelChoices = this.page.locator(modelOptionSelector);
    const maxModelChoiceCount = 30;

    const modelChoiceCount = await probeOrFallback(0, () => modelChoices.count());
    const total = Math.min(modelChoiceCount, maxModelChoiceCount);
    const models: ModelOption[] = [];
    for (let index = 0; index < total; index += 1) {
      const option = modelChoices.nth(index);
      const optionCopy = await probeOrFallback("", () => readVisibleCopy(option));
      const label = readFirstLine(optionCopy);

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
    await probeOrFallback(null, () => this.page.keyboard.press(ESCAPE_KEY));
    return models;
  };

  selectModel = async (query: string): Promise<string> => {
    const modelOptionSelector = this.selectors.modelOption;

    const isModelOptionSelectorMissing = modelOptionSelector == null;
    if (isModelOptionSelectorMissing) return this.profile.defaultModel;

    const isModelPickerStillClosed = !(await this.openModelPicker());
    if (isModelPickerStillClosed) return this.profile.defaultModel;

    const matchingOption = this.page
      .locator(modelOptionSelector)
      .filter({ hasText: query })
      .first();

    const optionClicked = await probeOrFallback(false, async () => {
      await matchingOption.click({ timeout: CLICK_TIMEOUT_MILLISECONDS });
      return true;
    });

    const isNotOptionClicked = !optionClicked;
    if (isNotOptionClicked) {
      await probeOrFallback(null, () => this.page.keyboard.press(ESCAPE_KEY));
      throw new Error(`${this.profile.displayName}: no model matching "${query}".`);
    }

    const modelSelectSettleMilliseconds = 600;

    await probeOrFallback(null, () => this.page.waitForTimeout(modelSelectSettleMilliseconds));
    return this.detectCurrentModel();
  };

  private openModelPicker = async (): Promise<boolean> => {
    const modelTriggerSelector = this.selectors.modelTrigger;

    const isModelTriggerSelectorMissing = modelTriggerSelector == null;
    if (isModelTriggerSelectorMissing) return false;

    const isPickerOpened = await probeOrFallback(false, async () => {
      await this.page
        .locator(modelTriggerSelector)
        .first()
        .click({ timeout: CONTROL_WAIT_TIMEOUT_MILLISECONDS });
      return true;
    });

    if (isPickerOpened) {
      const modelPickerSettleMilliseconds = 500;

      await probeOrFallback(null, () => this.page.waitForTimeout(modelPickerSettleMilliseconds));
    }

    return isPickerOpened;
  };

  rewindLastUserPrompt = async (): Promise<void> => {
    throw new Error(`${this.profile.displayName}: rewinding the last prompt is not supported.`);
  };

  stopGenerating = async (timeout = CONTROL_WAIT_TIMEOUT_MILLISECONDS): Promise<boolean> => {
    const stopButtonSelector = this.selectors.stop;

    const isProfileSelectorsStopMissing = stopButtonSelector == null;
    if (isProfileSelectorsStopMissing) return false;

    const stopControl = this.page.locator(stopButtonSelector).first();

    const isStopVisible = await probeOrFallback(false, () => stopControl.isVisible({ timeout }));

    if (isStopVisible) {
      await probeOrFallback(null, () => stopControl.click({ timeout }));
      return true;
    }

    return false;
  };

  attachFilesToPrompt = async (paths: string[]): Promise<void> => {
    const attachSelector = this.selectors.attach;

    const isAttachSelectorMissing = attachSelector == null;
    if (isAttachSelectorMissing) {
      throw new Error(`${this.profile.displayName}: attaching files is not supported.`);
    }

    await this.page.locator(attachSelector).first().setInputFiles(paths);
  };

  setupMcpConnector = async (
    url: string,
    setupSettings?: ConnectorSetupSettings,
  ): Promise<ConnectorSetupReport> => {
    const isConnectorSetupMissing = this.connectorSetup == null;
    if (isConnectorSetupMissing) {
      return {
        connectorUrl: url,
        completed: false,
        steps: [],
        warnings: [`${this.profile.displayName} has no MCP connector setup wired.`],
      };
    }

    return this.connectorSetup(this.page, url, setupSettings);
  };

  isLikelyModelLabel = (label: string): boolean => {
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
  };
}
