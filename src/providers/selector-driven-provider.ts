import type { Page } from "playwright";
import { type BridgeProviderId, DEFAULT_ASK_TIMEOUT_SECONDS, PROVIDER_SETTINGS } from "@/config";
import type {
  ConnectorSetupReport,
  ConnectorSetupSettings,
  ModelOption,
} from "@/domain/connector-types.ts";
import type { BrowserProvider, ReplyWaitSettings } from "./browser-provider.ts";
import { setupMcpConnectorInClaude } from "./claude-connector.ts";
import { setupMcpConnectorInGrok } from "./grok-connector.ts";
import { createStallReloadWatchdog } from "./render-stall-watchdog.ts";
import { isReplyGenerating, waitForReplyIdle } from "./streaming-guard.ts";

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

const readFirstLine = (lines: string): string => {
  const line = lines.trim().split("\n")[0];

  const isLineMissing = line === undefined;
  if (isLineMissing) return "";

  return line.trim();
};

const readReplyWaitSettings = (
  waitSettings: number | ReplyWaitSettings | undefined,
): ReplyWaitSettings => {
  const isWaitTypeNumber = typeof waitSettings === "number";
  if (isWaitTypeNumber) {
    return { timeout: waitSettings };
  }

  const isWaitMissing = waitSettings === undefined;
  if (isWaitMissing) {
    return {};
  }

  return waitSettings;
};

const waitTimeoutMs = (waitSettings: ReplyWaitSettings): number => {
  const isWaitSettingsTimeoutMissing = waitSettings.timeout === undefined;
  if (isWaitSettingsTimeoutMissing) {
    const actionTimeoutMilliseconds = 1000;

    return DEFAULT_ASK_TIMEOUT_SECONDS * actionTimeoutMilliseconds;
  }

  return waitSettings.timeout;
};

const readPreviousAssistantCount = (waitSettings: ReplyWaitSettings): number => {
  const isWaitSettingsPreviousAssistantCountMissing =
    waitSettings.previousAssistantCount === undefined;
  if (isWaitSettingsPreviousAssistantCountMissing) {
    return 0;
  }

  return waitSettings.previousAssistantCount;
};

const readPreviousLastAssistantReply = (waitSettings: ReplyWaitSettings): string => {
  if (waitSettings.previousLastAssistantText === undefined) {
    return "";
  }

  return waitSettings.previousLastAssistantText;
};

const stopControlSelector = (stopSelector: string | undefined): string => {
  const isStopSelectorMissing = stopSelector === undefined;
  if (isStopSelectorMissing) {
    return "";
  }

  return stopSelector;
};

export const createSelectorDrivenProvider = (providerId: BridgeProviderId): BrowserProvider => {
  const profile = { id: providerId, ...PROVIDER_SETTINGS[providerId] };
  const connectorSetup = CONNECTOR_SETUP[providerId];
  const { id, origin, defaultUrl, defaultModel, displayName, supportsMcpConnector } = profile;
  const composerSelector = profile.selectors.composer;
  const stopSelector = stopControlSelector(profile.selectors.stop);

  const assertSignedIn = async (page: Page): Promise<void> => {
    const signedOutSelector = profile.selectors.signedOut;

    const hasSignedOutSelector = signedOutSelector !== undefined;
    if (hasSignedOutSelector) {
      const signedOutCount = await page
        .locator(signedOutSelector)
        .count()
        .catch(() => 0);

      const isSignedOutFound = signedOutCount > 0;
      if (isSignedOutFound) {
        throw new Error(
          `${displayName}: not signed in. Run \`bridge chrome start --provider ${id}\` and sign in if needed.`,
        );
      }
    }

    const composerCount = await page
      .locator(composerSelector)
      .count()
      .catch(() => 0);

    const isComposerMissing = composerCount === 0;
    if (isComposerMissing) {
      throw new Error(
        `${displayName}: composer not found — the page UI may have changed, or you are not signed in.`,
      );
    }
  };

  const injectPrompt = async (page: Page, prompt: string): Promise<void> => {
    const composer = page.locator(composerSelector).filter({ visible: true }).first();
    const maxPromptInjectAttempts = 3;

    for (let attempt = 0; attempt < maxPromptInjectAttempts; attempt += 1) {
      // Wait out any in-flight response first so a retry never sends on top of one.
      await waitForReplyIdle(page, stopSelector);
      await composer.click();
      await composer.fill(prompt).catch(() => composer.type(prompt));
      await submitPrompt(page);

      const hasComposerCleared = await isComposerCleared(page);
      if (hasComposerCleared) return;

      // An active stream means the prompt landed even if the composer was slow to empty.
      const isStillStreaming = await isReplyGenerating(page, stopSelector);
      if (isStillStreaming) return;
    }
    throw new Error(`${displayName}: composer never cleared after 3 send attempts.`);
  };

  const submitPrompt = async (page: Page): Promise<void> => {
    const sendSelector = profile.selectors.send;

    const hasSendSelector = sendSelector !== undefined;
    if (hasSendSelector) {
      const sendClicked = await page
        .locator(sendSelector)
        .filter({ visible: true })
        .first()
        .click({ timeout: CLICK_TIMEOUT_MILLISECONDS })
        .then(() => true)
        .catch(() => false);
      if (sendClicked) return;
    }

    // Only press Enter when idle — doing it mid-stream risks interrupting the response.
    const isStillStreamingLater = await isReplyGenerating(page, stopSelector);
    if (isStillStreamingLater) return;

    await page.keyboard.press("Enter").catch(() => undefined);
  };

  const isComposerCleared = async (page: Page): Promise<boolean> => {
    const composer = page.locator(composerSelector).filter({ visible: true }).first();
    const maxComposerClearChecks = 10;

    for (let poll = 0; poll < maxComposerClearChecks; poll += 1) {
      const composerDraft = await composer
        .inputValue()
        .catch(() => composer.innerText().catch(() => ""));

      const isComposerDraftEmpty = composerDraft.trim() === "";
      if (isComposerDraftEmpty) return true;

      await page.waitForTimeout(QUICK_SETTLE_MILLISECONDS).catch(() => undefined);
    }
    return false;
  };

  const waitForReply = async (
    page: Page,
    waitSettings?: number | ReplyWaitSettings,
  ): Promise<void> => {
    const replyWaitSettings = readReplyWaitSettings(waitSettings);
    const timeoutMs = waitTimeoutMs(replyWaitSettings);
    const assistantCountBefore = readPreviousAssistantCount(replyWaitSettings);
    const lastAssistantReplyBefore = readPreviousLastAssistantReply(replyWaitSettings);
    // A count increase covers most chats; a text change covers UIs that edit the last reply in place.
    await page
      .waitForFunction(
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
        { timeout: timeoutMs },
      )
      .catch(() => undefined);
    await waitForStreamIdle(page, timeoutMs);
  };

  // Reloads when the reply stays absent past the stall threshold, so a stuck render re-syncs.
  const waitForStreamIdle = async (page: Page, budgetMs: number): Promise<void> => {
    const deadline = Date.now() + budgetMs;
    const watchdog = createStallReloadWatchdog({
      waitAfterReload: (target) => waitForComposerReady(target),
      onReload: (reloadCount) =>
        process.stderr.write(
          `[bridge] ${displayName} render stalled — reloaded tab (reload ${reloadCount}).\n`,
        ),
    });
    let previousAssistantReply = "";
    while (Date.now() < deadline) {
      const currentAssistantReply = await captureLastReply(page).catch(() => "");

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

      if (hasAssistantReplyChanged) {
        previousAssistantReply = currentAssistantReply;
        watchdog.noteProgress();
      } else if (isNotStillStreaming && (await watchdog.reloadIfStalled(page))) {
        previousAssistantReply = "";
        continue;
      }

      await page.waitForTimeout(QUICK_SETTLE_MILLISECONDS).catch(() => undefined);
    }
  };

  const waitForComposerReady = async (page: Page): Promise<void> => {
    const waitTimeoutMilliseconds = 15_000;

    await page
      .waitForSelector(composerSelector, { timeout: waitTimeoutMilliseconds })
      .catch(() => undefined);
  };

  const captureLastReply = async (page: Page): Promise<string> => {
    const lastAssistant = page.locator(profile.selectors.assistant).last();
    const lastAssistantReply = await lastAssistant.innerText().catch(() => "");
    return lastAssistantReply.trim();
  };

  const countAssistantReplies = async (page: Page): Promise<number> => {
    return page
      .locator(profile.selectors.assistant)
      .count()
      .catch(() => 0);
  };

  const captureAllMessages = async (
    page: Page,
  ): Promise<Array<{ role: string; content: string }>> => {
    const assistantReplies = await page
      .locator(profile.selectors.assistant)
      .allInnerTexts()
      .catch(() => [] as string[]);
    const assistantMessages = assistantReplies.map((reply) => ({
      role: "assistant",
      content: reply.trim(),
    }));
    const userSelector = profile.selectors.user;

    const isUserSelectorMissing = userSelector === undefined;
    if (isUserSelectorMissing) return assistantMessages;

    const userPrompts = await page
      .locator(userSelector)
      .allInnerTexts()
      .catch(() => [] as string[]);
    const userMessages = userPrompts.map((userPrompt) => ({
      role: "user",
      content: userPrompt.trim(),
    }));
    return [...userMessages, ...assistantMessages];
  };

  const readSidebarConversations = async (
    page: Page,
  ): Promise<Array<{ id: string; title: string; url: string }>> => {
    const sidebarElementSelector = profile.selectors.sidebarItem;

    const isSidebarSelectorMissing = sidebarElementSelector === undefined;
    if (isSidebarSelectorMissing) return [];

    const links = page.locator(sidebarElementSelector);
    const maxLinkCount = 40;

    const linkCount = await links.count().catch(() => 0);
    const total = Math.min(linkCount, maxLinkCount);
    const baseUrl = `https://${origin}`;
    const conversations: Array<{ id: string; title: string; url: string }> = [];
    for (let index = 0; index < total; index += 1) {
      const link = links.nth(index);

      const href = await link.getAttribute("href").catch(() => null);

      const isHrefBlank = href === null || href.length === 0;
      if (isHrefBlank) continue;

      const conversationUrl = new URL(href, baseUrl).toString();
      const title = readFirstLine(await link.innerText().catch(() => ""));
      const pathSegment = href.split("/").filter(Boolean).pop();
      let conversationId = href;

      const hasPathSegment = pathSegment !== undefined;
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
  };

  const navigateToConversation = async (page: Page, url: string): Promise<void> => {
    await page.goto(url, { waitUntil: "domcontentloaded" });
  };

  const startNewConversation = async (page: Page): Promise<void> => {
    const newChatSelector = profile.selectors.newChat;

    const hasNewChatSelector = newChatSelector !== undefined;
    if (hasNewChatSelector) {
      const newChatClicked = await page
        .locator(newChatSelector)
        .first()
        .click({ timeout: CLICK_TIMEOUT_MILLISECONDS })
        .then(() => true)
        .catch(() => false);
      if (newChatClicked) {
        await page.waitForTimeout(QUICK_SETTLE_MILLISECONDS).catch(() => undefined);
        return;
      }
    }

    await page.goto(defaultUrl, { waitUntil: "domcontentloaded" });
  };

  const detectCurrentModel = async (page: Page): Promise<string> => {
    const modelTriggerSelector = profile.selectors.modelTrigger;

    const isModelTriggerSelectorMissing = modelTriggerSelector === undefined;
    if (isModelTriggerSelectorMissing) return defaultModel;

    const triggerLabel = await page
      .locator(modelTriggerSelector)
      .first()
      .innerText()
      .catch(() => "");

    const modelLabel = readFirstLine(triggerLabel);

    const isModelLabelUsable = modelLabel.length > 0 && isLikelyModelLabel(modelLabel);
    if (isModelLabelUsable) {
      return modelLabel;
    }

    return defaultModel;
  };

  const listAvailableModels = async (page: Page): Promise<ModelOption[]> => {
    const modelOptionSelector = profile.selectors.modelOption;

    const isModelOptionSelectorMissing = modelOptionSelector === undefined;
    if (isModelOptionSelectorMissing) return [];

    const isModelPickerNotOpened = !(await openModelPicker(page));
    if (isModelPickerNotOpened) return [];

    const modelChoices = page.locator(modelOptionSelector);
    const maxModelChoiceCount = 30;

    const modelChoiceCount = await modelChoices.count().catch(() => 0);
    const total = Math.min(modelChoiceCount, maxModelChoiceCount);
    const models: ModelOption[] = [];
    for (let index = 0; index < total; index += 1) {
      const option = modelChoices.nth(index);
      const label = readFirstLine(await option.innerText().catch(() => ""));

      const isLabelEmpty = label.length === 0;
      if (isLabelEmpty) continue;

      const ariaChecked = await option.getAttribute("aria-checked").catch(() => null);
      const ariaSelected = await option.getAttribute("aria-selected").catch(() => null);
      models.push({
        id: label,
        label,
        selected: ariaChecked === "true" || ariaSelected === "true",
      });
    }
    await page.keyboard.press("Escape").catch(() => undefined);
    return models;
  };

  const selectModel = async (page: Page, query: string): Promise<string> => {
    const modelOptionSelector = profile.selectors.modelOption;

    const isModelOptionSelectorMissing = modelOptionSelector === undefined;
    if (isModelOptionSelectorMissing) return defaultModel;

    const isModelPickerStillClosed = !(await openModelPicker(page));
    if (isModelPickerStillClosed) return defaultModel;

    const matchingOption = page.locator(modelOptionSelector).filter({ hasText: query }).first();

    const optionClicked = await matchingOption
      .click({ timeout: CLICK_TIMEOUT_MILLISECONDS })
      .then(() => true)
      .catch(() => false);

    const isNotOptionClicked = !optionClicked;
    if (isNotOptionClicked) {
      await page.keyboard.press("Escape").catch(() => undefined);
      throw new Error(`${displayName}: no model matching "${query}".`);
    }

    const modelSelectSettleMilliseconds = 600;

    await page.waitForTimeout(modelSelectSettleMilliseconds).catch(() => undefined);
    return detectCurrentModel(page);
  };

  const openModelPicker = async (page: Page): Promise<boolean> => {
    const modelTriggerSelector = profile.selectors.modelTrigger;

    const isModelTriggerSelectorMissing = modelTriggerSelector === undefined;
    if (isModelTriggerSelectorMissing) return false;

    const pickerOpened = await page
      .locator(modelTriggerSelector)
      .first()
      .click({ timeout: CONTROL_WAIT_TIMEOUT_MILLISECONDS })
      .then(() => true)
      .catch(() => false);
    if (pickerOpened) {
      const modelPickerSettleMilliseconds = 500;

      await page.waitForTimeout(modelPickerSettleMilliseconds).catch(() => undefined);
    }

    return pickerOpened;
  };

  const rewindLastUserPrompt = async (_page: Page): Promise<void> => {
    throw new Error(`${displayName}: rewinding the last prompt is not supported.`);
  };

  const stopGenerating = async (
    page: Page,
    timeout = CONTROL_WAIT_TIMEOUT_MILLISECONDS,
  ): Promise<boolean> => {
    const isProfileSelectorsStopMissing = profile.selectors.stop === undefined;
    if (isProfileSelectorsStopMissing) return false;

    const stopControl = page.locator(profile.selectors.stop).first();

    const stopVisible = await stopControl.isVisible({ timeout }).catch(() => false);

    const isNotStopVisible = !stopVisible;
    if (isNotStopVisible) return false;

    await stopControl.click({ timeout }).catch(() => undefined);
    return true;
  };

  const attachFilesToPrompt = async (page: Page, paths: string[]): Promise<void> => {
    const attachSelector = profile.selectors.attach;

    const isAttachSelectorMissing = attachSelector === undefined;
    if (isAttachSelectorMissing) {
      throw new Error(`${displayName}: attaching files is not supported.`);
    }

    await page.locator(attachSelector).first().setInputFiles(paths);
  };

  const setupMcpConnector = async (
    page: Page,
    url: string,
    setupSettings?: ConnectorSetupSettings,
  ): Promise<ConnectorSetupReport> => {
    const isConnectorSetupMissing = connectorSetup === undefined;
    if (isConnectorSetupMissing) {
      return {
        connectorUrl: url,
        completed: false,
        steps: [],
        warnings: [`${displayName} has no MCP connector setup wired.`],
      };
    }

    return connectorSetup(page, url, setupSettings);
  };

  const isLikelyModelLabel = (label: string): boolean => {
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

  return {
    id,
    origin,
    defaultUrl,
    defaultModel,
    displayName,
    composerSelector,
    supportsMcpConnector,
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
  } satisfies BrowserProvider;
};
