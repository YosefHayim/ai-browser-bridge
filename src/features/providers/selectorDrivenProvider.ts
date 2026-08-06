import type { Page } from "playwright";
import { type BridgeProviderId, DEFAULT_ASK_TIMEOUT_SECONDS, PROVIDER_CONFIG } from "@/config";
import type { ConnectorSetupOptions, ConnectorSetupResult, ModelOption } from "@/features/domain";
import type { BrowserProvider, ResponseWaitOptions } from "./browserProvider.ts";
import { setupMcpConnectorInClaude } from "./claudeConnector.ts";
import { setupMcpConnectorInGrok } from "./grokConnector.ts";
import { stallReloadWatchdogFor } from "./renderStallWatchdog.ts";
import { isResponseGenerating, waitForResponseIdle } from "./streamingGuard.ts";

const MODEL_KEYWORDS = [
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
];

type ConnectorSetup = (
  page: Page,
  url: string,
  options?: ConnectorSetupOptions,
) => Promise<ConnectorSetupResult>;

const CONNECTOR_SETUP: Partial<Record<BridgeProviderId, ConnectorSetup>> = {
  claude: setupMcpConnectorInClaude,
  grok: setupMcpConnectorInGrok,
};

const firstLine = (text: string): string => {
  const line = text.trim().split("\n")[0];
  if (line === undefined) return "";
  return line.trim();
};

const responseWaitOptions = (
  waitOptions: number | ResponseWaitOptions | undefined,
): ResponseWaitOptions => {
  if (typeof waitOptions === "number") {
    return { timeout: waitOptions };
  }
  if (waitOptions === undefined) {
    return {};
  }
  return waitOptions;
};

const waitTimeoutMs = (waitOptions: ResponseWaitOptions): number => {
  if (waitOptions.timeout === undefined) {
    return DEFAULT_ASK_TIMEOUT_SECONDS * 1000;
  }
  return waitOptions.timeout;
};

const previousAssistantCount = (waitOptions: ResponseWaitOptions): number => {
  if (waitOptions.previousAssistantCount === undefined) {
    return 0;
  }
  return waitOptions.previousAssistantCount;
};

const previousLastAssistantText = (waitOptions: ResponseWaitOptions): string => {
  if (waitOptions.previousLastAssistantText === undefined) {
    return "";
  }
  return waitOptions.previousLastAssistantText;
};

const stopControlSelector = (stopSelector: string | undefined): string => {
  if (stopSelector === undefined) {
    return "";
  }
  return stopSelector;
};

export const selectorDrivenProvider = (providerId: BridgeProviderId): BrowserProvider => {
  const profile = { id: providerId, ...PROVIDER_CONFIG[providerId] };
  const connectorSetup = CONNECTOR_SETUP[providerId];
  const { id, origin, defaultUrl, defaultModel, displayName, supportsMcpConnector } = profile;
  const composerSelector = profile.selectors.composer;
  const stopSelector = stopControlSelector(profile.selectors.stop);

  const assertSignedIn = async (page: Page): Promise<void> => {
    const signedOutSelector = profile.selectors.signedOut;
    if (signedOutSelector !== undefined) {
      const signedOutCount = await page
        .locator(signedOutSelector)
        .count()
        .catch(() => 0);
      if (signedOutCount > 0) {
        throw new Error(
          `${displayName}: not signed in. Run \`bridge chrome start --provider ${id}\` and sign in if needed.`,
        );
      }
    }
    const composerCount = await page
      .locator(composerSelector)
      .count()
      .catch(() => 0);
    if (composerCount === 0) {
      throw new Error(
        `${displayName}: composer not found — the page UI may have changed, or you are not signed in.`,
      );
    }
  };

  const injectPrompt = async (page: Page, text: string): Promise<void> => {
    const composer = page.locator(composerSelector).first();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      // Wait out any in-flight response first so a retry never sends on top of one.
      await waitForResponseIdle(page, stopSelector);
      await composer.click();
      await composer.fill(text).catch(() => composer.type(text));
      await submitPrompt(page);
      if (await composerCleared(page)) return;
      // An active stream means the prompt landed even if the composer was slow to empty.
      if (await isResponseGenerating(page, stopSelector)) return;
    }
    throw new Error(`${displayName}: composer never cleared after 3 send attempts.`);
  };

  const submitPrompt = async (page: Page): Promise<void> => {
    const sendSelector = profile.selectors.send;
    if (sendSelector !== undefined) {
      const sendClicked = await page
        .locator(sendSelector)
        .first()
        .click({ timeout: 4_000 })
        .then(() => true)
        .catch(() => false);
      if (sendClicked) return;
    }
    // Only press Enter when idle — doing it mid-stream risks interrupting the response.
    if (await isResponseGenerating(page, stopSelector)) return;
    await page.keyboard.press("Enter").catch(() => undefined);
  };

  const composerCleared = async (page: Page): Promise<boolean> => {
    const composer = page.locator(composerSelector).first();
    for (let poll = 0; poll < 10; poll += 1) {
      const composerText = await composer
        .inputValue()
        .catch(() => composer.innerText().catch(() => ""));
      if (composerText.trim() === "") return true;
      await page.waitForTimeout(400).catch(() => undefined);
    }
    return false;
  };

  const waitForResponse = async (
    page: Page,
    waitOptions?: number | ResponseWaitOptions,
  ): Promise<void> => {
    const options = responseWaitOptions(waitOptions);
    const timeoutMs = waitTimeoutMs(options);
    const assistantCountBefore = previousAssistantCount(options);
    const lastAssistantTextBefore = previousLastAssistantText(options);
    // Count increase covers most chats; text change covers UIs that rewrite the last
    // assistant node in place instead of appending a new message.
    await page
      .waitForFunction(
        (args) => {
          const nodes = document.querySelectorAll(args.assistantSelector);
          if (nodes.length > args.previousCount) return true;
          if (args.previousText.length === 0) return false;
          const lastNode = nodes.item(nodes.length - 1);
          if (lastNode === null || lastNode.textContent === null) return false;
          const assistantText = lastNode.textContent.trim();
          return (
            nodes.length > 0 && assistantText.length > 0 && assistantText !== args.previousText
          );
        },
        {
          assistantSelector: profile.selectors.assistant,
          previousCount: assistantCountBefore,
          previousText: lastAssistantTextBefore,
        },
        { timeout: timeoutMs },
      )
      .catch(() => undefined);
    await waitForStreamIdle(page, timeoutMs);
  };

  // Poll until the last assistant message is stable across two reads. Reload when the
  // reply stays absent past the stall threshold so a stuck render re-syncs with server truth.
  const waitForStreamIdle = async (page: Page, budgetMs: number): Promise<void> => {
    const deadline = Date.now() + budgetMs;
    const watchdog = stallReloadWatchdogFor({
      waitAfterReload: (target) => waitForComposerReady(target),
      onReload: (reloadCount) =>
        process.stderr.write(
          `[bridge] ${displayName} render stalled — reloaded tab (reload ${reloadCount}).\n`,
        ),
    });
    let previousAssistantText = "";
    while (Date.now() < deadline) {
      const currentAssistantText = await captureLastResponse(page).catch(() => "");
      // Duck.ai parks a stable placeholder like "Generating response" while the stop
      // control is still up — only treat text as final once streaming ends.
      const stillStreaming = await isResponseGenerating(page, stopSelector);
      if (
        currentAssistantText.length > 0 &&
        currentAssistantText === previousAssistantText &&
        !stillStreaming
      ) {
        return;
      }
      if (currentAssistantText !== previousAssistantText) {
        previousAssistantText = currentAssistantText;
        watchdog.noteProgress();
      } else if (!stillStreaming && (await watchdog.maybeReload(page))) {
        previousAssistantText = "";
        continue;
      }
      await page.waitForTimeout(400).catch(() => undefined);
    }
  };

  const waitForComposerReady = async (page: Page): Promise<void> => {
    await page.waitForSelector(composerSelector, { timeout: 15_000 }).catch(() => undefined);
  };

  const captureLastResponse = async (page: Page): Promise<string> => {
    const lastAssistant = page.locator(profile.selectors.assistant).last();
    return (await lastAssistant.innerText().catch(() => "")).trim();
  };

  const countAssistantResponses = async (page: Page): Promise<number> => {
    return page
      .locator(profile.selectors.assistant)
      .count()
      .catch(() => 0);
  };

  const captureAllMessages = async (
    page: Page,
  ): Promise<Array<{ role: string; content: string }>> => {
    const assistantTexts = await page
      .locator(profile.selectors.assistant)
      .allInnerTexts()
      .catch(() => [] as string[]);
    const assistantMessages = assistantTexts.map((content) => ({
      role: "assistant",
      content: content.trim(),
    }));
    const userSelector = profile.selectors.user;
    if (userSelector === undefined) return assistantMessages;
    const userTexts = await page
      .locator(userSelector)
      .allInnerTexts()
      .catch(() => [] as string[]);
    const userMessages = userTexts.map((content) => ({
      role: "user",
      content: content.trim(),
    }));
    return [...userMessages, ...assistantMessages];
  };

  const readSidebarConversations = async (
    page: Page,
  ): Promise<Array<{ id: string; title: string; url: string }>> => {
    const sidebarItemSelector = profile.selectors.sidebarItem;
    if (sidebarItemSelector === undefined) return [];
    const links = page.locator(sidebarItemSelector);
    const total = Math.min(await links.count().catch(() => 0), 40);
    const baseUrl = `https://${origin}`;
    const conversations: Array<{ id: string; title: string; url: string }> = [];
    for (let index = 0; index < total; index += 1) {
      const link = links.nth(index);
      const href = await link.getAttribute("href").catch(() => null);
      if (href === null || href.length === 0) continue;
      const conversationUrl = new URL(href, baseUrl).toString();
      const title = firstLine(await link.innerText().catch(() => ""));
      const pathSegment = href.split("/").filter(Boolean).pop();
      let conversationId = href;
      if (pathSegment !== undefined) {
        conversationId = pathSegment;
      }
      let conversationTitle = conversationId;
      if (title.length > 0) {
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

  const newConversation = async (page: Page): Promise<void> => {
    const newChatSelector = profile.selectors.newChat;
    if (newChatSelector !== undefined) {
      const newChatClicked = await page
        .locator(newChatSelector)
        .first()
        .click({ timeout: 4_000 })
        .then(() => true)
        .catch(() => false);
      if (newChatClicked) {
        await page.waitForTimeout(400).catch(() => undefined);
        return;
      }
    }
    await page.goto(defaultUrl, { waitUntil: "domcontentloaded" });
  };

  const detectCurrentModel = async (page: Page): Promise<string> => {
    const modelTriggerSelector = profile.selectors.modelTrigger;
    if (modelTriggerSelector === undefined) return defaultModel;
    const triggerText = await page
      .locator(modelTriggerSelector)
      .first()
      .innerText()
      .catch(() => "");
    const modelLabel = firstLine(triggerText);
    if (modelLabel.length > 0 && isLikelyModelLabel(modelLabel)) {
      return modelLabel;
    }
    return defaultModel;
  };

  const listAvailableModels = async (page: Page): Promise<ModelOption[]> => {
    const modelOptionSelector = profile.selectors.modelOption;
    if (modelOptionSelector === undefined) return [];
    if (!(await openModelPicker(page))) return [];
    const options = page.locator(modelOptionSelector);
    const total = Math.min(await options.count().catch(() => 0), 30);
    const models: ModelOption[] = [];
    for (let index = 0; index < total; index += 1) {
      const option = options.nth(index);
      const label = firstLine(await option.innerText().catch(() => ""));
      if (label.length === 0) continue;
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
    if (modelOptionSelector === undefined) return defaultModel;
    if (!(await openModelPicker(page))) return defaultModel;
    const matchingOption = page.locator(modelOptionSelector).filter({ hasText: query }).first();
    const optionClicked = await matchingOption
      .click({ timeout: 4_000 })
      .then(() => true)
      .catch(() => false);
    if (!optionClicked) {
      await page.keyboard.press("Escape").catch(() => undefined);
      throw new Error(`${displayName}: no model matching "${query}".`);
    }
    await page.waitForTimeout(600).catch(() => undefined);
    return detectCurrentModel(page);
  };

  const openModelPicker = async (page: Page): Promise<boolean> => {
    const modelTriggerSelector = profile.selectors.modelTrigger;
    if (modelTriggerSelector === undefined) return false;
    const pickerOpened = await page
      .locator(modelTriggerSelector)
      .first()
      .click({ timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (pickerOpened) {
      await page.waitForTimeout(500).catch(() => undefined);
    }
    return pickerOpened;
  };

  const rewindLastUserPrompt = async (_page: Page): Promise<void> => {
    throw new Error(`${displayName}: rewinding the last prompt is not supported.`);
  };

  const stopGenerating = async (page: Page, timeout = 5_000): Promise<boolean> => {
    if (profile.selectors.stop === undefined) return false;
    const stopControl = page.locator(profile.selectors.stop).first();
    const stopVisible = await stopControl.isVisible({ timeout }).catch(() => false);
    if (!stopVisible) return false;
    await stopControl.click({ timeout }).catch(() => undefined);
    return true;
  };

  const attachFilesToPrompt = async (page: Page, paths: string[]): Promise<void> => {
    const attachSelector = profile.selectors.attach;
    if (attachSelector === undefined) {
      throw new Error(`${displayName}: attaching files is not supported.`);
    }
    await page.locator(attachSelector).first().setInputFiles(paths);
  };

  const setupMcpConnector = async (
    page: Page,
    url: string,
    options?: ConnectorSetupOptions,
  ): Promise<ConnectorSetupResult> => {
    if (connectorSetup === undefined) {
      return {
        connectorUrl: url,
        completed: false,
        steps: [],
        warnings: [`${displayName} has no MCP connector setup wired.`],
      };
    }
    return connectorSetup(page, url, options);
  };

  const isLikelyModelLabel = (value: string): boolean => {
    const trimmed = value.trim().toLowerCase();
    if (trimmed.length === 0) return false;
    if (trimmed.length > 40) return false;
    return MODEL_KEYWORDS.some((keyword) => trimmed.includes(keyword));
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
    setupMcpConnector,
  } satisfies BrowserProvider;
};
