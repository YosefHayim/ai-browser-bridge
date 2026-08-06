import type { Page } from "playwright";
import { type BridgeProviderId, DEFAULT_ASK_TIMEOUT_SECONDS, PROVIDER_CONFIG } from "@/config";
import type { ConnectorSetupOptions, ConnectorSetupResult, ModelOption } from "@/features/domain";
import type { BrowserProvider, ResponseWaitOptions } from "./browserProvider.ts";
import { setupMcpConnectorInClaude } from "./claudeConnector.ts";
import { setupMcpConnectorInGrok } from "./grokConnector.ts";
import { createStallReloadWatchdog } from "./renderStallWatchdog.ts";
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

/** First display line of a text block (safe under noUncheckedIndexedAccess). */
const firstLine = (text: string): string => {
  const line = text.trim().split("\n")[0];
  if (line === undefined) return "";
  return line.trim();
};

export const selectorDrivenProvider = (providerId: BridgeProviderId): BrowserProvider => {
  const profile = { id: providerId, ...PROVIDER_CONFIG[providerId] };
  const connectorSetup = CONNECTOR_SETUP[providerId];
  const { id, origin, defaultUrl, defaultModel, displayName, supportsMcpConnector } = profile;
  const composerSelector = profile.selectors.composer;

  /**
   * Throw when the composer is absent or a signed-out marker is present.
   *
   * @param page - Page value.
   * @returns Completes when `assertSignedIn` finishes.
   * @example
   * ```ts
   * await provider.assertSignedIn(page);
   * ```
   */
  const assertSignedIn = async (page: Page): Promise<void> => {
    if (profile.selectors.signedOut) {
      const signedOut = await page
        .locator(profile.selectors.signedOut)
        .count()
        .catch(() => 0);
      if (signedOut > 0) {
        throw new Error(
          `${displayName}: not signed in. Run \`bridge chrome start --provider ${id}\` and sign in if needed.`,
        );
      }
    }
    const composer = await page
      .locator(composerSelector)
      .count()
      .catch(() => 0);
    if (composer === 0) {
      throw new Error(
        `${displayName}: composer not found — the page UI may have changed, or you are not signed in.`,
      );
    }
  };

  /**
   * Type the prompt into the composer and submit it, retrying until it clears.
   *
   * @param page - Page value.
   * @param text - Text value.
   * @returns Completes when `injectPrompt` finishes.
   * @example
   * ```ts
   * await provider.injectPrompt(page, text);
   * ```
   */
  const injectPrompt = async (page: Page, text: string): Promise<void> => {
    const composer = page.locator(composerSelector).first();
    const stopSelector = profile.selectors.stop ?? "";
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

  /** Click the configured send button when visible, otherwise press Enter. */
  const submitPrompt = async (page: Page): Promise<void> => {
    const sendSelector = profile.selectors.send;
    if (sendSelector) {
      const clicked = await page
        .locator(sendSelector)
        .first()
        .click({ timeout: 4_000 })
        .then(() => true)
        .catch(() => false);
      if (clicked) return;
    }
    // Only press Enter when idle — doing it mid-stream risks interrupting the response.
    if (await isResponseGenerating(page, profile.selectors.stop ?? "")) return;
    await page.keyboard.press("Enter").catch(() => undefined);
  };

  /** Poll until the composer is empty again — the provider accepted the prompt. */
  const composerCleared = async (page: Page): Promise<boolean> => {
    const composer = page.locator(composerSelector).first();
    for (let poll = 0; poll < 10; poll += 1) {
      const text = await composer.inputValue().catch(() => composer.innerText().catch(() => ""));
      if (text.trim() === "") return true;
      await page.waitForTimeout(400).catch(() => undefined);
    }
    return false;
  };

  /**
   * Wait for a new assistant message to appear, then for its text to stop growing.
   *
   * @param page - Page value.
   * @param options - Options that configure the method.
   * @returns Completes when `waitForResponse` finishes.
   * @example
   * ```ts
   * await provider.waitForResponse(page, options);
   * ```
   */
  const waitForResponse = async (
    page: Page,
    options?: number | ResponseWaitOptions,
  ): Promise<void> => {
    const opts = typeof options === "number" ? { timeout: options } : (options ?? {});
    const timeout = opts.timeout ?? DEFAULT_ASK_TIMEOUT_SECONDS * 1000;
    const before = opts.previousAssistantCount ?? 0;
    const previousText = opts.previousLastAssistantText ?? "";
    // Count increase covers most chats; text change covers UIs (e.g. Arena battle
    // cards) that rewrite the last assistant node in place instead of appending.
    await page
      .waitForFunction(
        (args) => {
          const nodes = document.querySelectorAll(args.sel);
          if (nodes.length > args.prev) return true;
          if (!args.prevText) return false;
          const last = nodes.item(nodes.length - 1);
          const text = (last?.textContent ?? "").trim();
          return nodes.length > 0 && text.length > 0 && text !== args.prevText;
        },
        { sel: profile.selectors.assistant, prev: before, prevText: previousText },
        { timeout },
      )
      .catch(() => undefined);
    await waitForStreamIdle(page, timeout);
  };

  /**
   * Poll the last assistant message until its text is stable across two reads, reloading the
   * tab when the reply stays absent past the stall threshold so a stuck render re-syncs with
   * server truth instead of waiting out the whole timeout.
   */
  const waitForStreamIdle = async (page: Page, budgetMs: number): Promise<void> => {
    const deadline = Date.now() + budgetMs;
    const stopSelector = profile.selectors.stop ?? "";
    const watchdog = createStallReloadWatchdog({
      waitAfterReload: (target) => waitForComposerReady(target),
      onReload: (count) =>
        process.stderr.write(
          `[bridge] ${displayName} render stalled — reloaded tab (reload ${count}).\n`,
        ),
    });
    let previous = "";
    while (Date.now() < deadline) {
      const current = await captureLastResponse(page).catch(() => "");
      // Some UIs (e.g. Duck.ai) park a stable placeholder like "Generating response"
      // while the stop control is still up — only treat text as final once streaming ends.
      const stillStreaming = await isResponseGenerating(page, stopSelector);
      if (current && current === previous && !stillStreaming) return;
      if (current !== previous) {
        previous = current;
        watchdog.noteProgress();
      } else if (!stillStreaming && (await watchdog.maybeReload(page))) {
        // Reply stayed absent past the stall threshold — reloaded; re-baseline the poll.
        previous = "";
        continue;
      }
      await page.waitForTimeout(400).catch(() => undefined);
    }
  };

  /** After a reload, wait for the composer to reappear before the next read. */
  const waitForComposerReady = async (page: Page): Promise<void> => {
    await page.waitForSelector(composerSelector, { timeout: 15_000 }).catch(() => undefined);
  };

  /**
   * Read the text of the latest assistant message.
   *
   * @param page - Page value.
   * @returns The `captureLastResponse` result.
   * @example
   * ```ts
   * const result = await provider.captureLastResponse(page);
   * ```
   */
  const captureLastResponse = async (page: Page): Promise<string> => {
    const last = page.locator(profile.selectors.assistant).last();
    return (await last.innerText().catch(() => "")).trim();
  };

  /**
   * Count rendered assistant messages.
   *
   * @param page - Page value.
   * @returns The `countAssistantResponses` result.
   * @example
   * ```ts
   * const result = await provider.countAssistantResponses(page);
   * ```
   */
  const countAssistantResponses = async (page: Page): Promise<number> => {
    return page
      .locator(profile.selectors.assistant)
      .count()
      .catch(() => 0);
  };

  /**
   * Capture the transcript as role-tagged messages (assistant, plus user when known).
   *
   * @param page - Page value.
   * @returns The `captureAllMessages` result.
   * @example
   * ```ts
   * const result = await provider.captureAllMessages(page);
   * ```
   */
  const captureAllMessages = async (
    page: Page,
  ): Promise<Array<{ role: string; content: string }>> => {
    const assistant = await page
      .locator(profile.selectors.assistant)
      .allInnerTexts()
      .catch(() => [] as string[]);
    const messages = assistant.map((content) => ({ role: "assistant", content: content.trim() }));
    if (!profile.selectors.user) return messages;
    const user = await page
      .locator(profile.selectors.user)
      .allInnerTexts()
      .catch(() => [] as string[]);
    return [...user.map((content) => ({ role: "user", content: content.trim() })), ...messages];
  };

  /**
   * List history conversations from the sidebar via the configured `sidebarItem` selector.
   *
   * @param page - Page value.
   * @returns The `readSidebarConversations` result.
   * @example
   * ```ts
   * const result = await provider.readSidebarConversations(page);
   * ```
   */
  const readSidebarConversations = async (
    page: Page,
  ): Promise<Array<{ id: string; title: string; url: string }>> => {
    const selector = profile.selectors.sidebarItem;
    if (!selector) return [];
    const links = page.locator(selector);
    const total = Math.min(await links.count().catch(() => 0), 40);
    const base = `https://${origin}`;
    const conversations: Array<{ id: string; title: string; url: string }> = [];
    for (let index = 0; index < total; index += 1) {
      const link = links.nth(index);
      const href = await link.getAttribute("href").catch(() => null);
      if (!href) continue;
      const url = new URL(href, base).toString();
      const title = firstLine(await link.innerText().catch(() => ""));
      const id = href.split("/").filter(Boolean).pop() ?? href;
      conversations.push({ id, title: title || id, url });
    }
    return conversations;
  };

  /**
   * Open a conversation by URL.
   *
   * @param page - Page value.
   * @param url - Url value.
   * @returns Completes when `navigateToConversation` finishes.
   * @example
   * ```ts
   * await provider.navigateToConversation(page, url);
   * ```
   */
  const navigateToConversation = async (page: Page, url: string): Promise<void> => {
    await page.goto(url, { waitUntil: "domcontentloaded" });
  };

  /**
   * Start a new conversation via the `newChat` control, or by navigating home.
   *
   * @param page - Page value.
   * @returns Completes when `newConversation` finishes.
   * @example
   * ```ts
   * await provider.newConversation(page);
   * ```
   */
  const newConversation = async (page: Page): Promise<void> => {
    const selector = profile.selectors.newChat;
    if (selector) {
      const clicked = await page
        .locator(selector)
        .first()
        .click({ timeout: 4_000 })
        .then(() => true)
        .catch(() => false);
      if (clicked) {
        await page.waitForTimeout(400).catch(() => undefined);
        return;
      }
    }
    await page.goto(defaultUrl, { waitUntil: "domcontentloaded" });
  };

  /**
   * Read the current model from the picker trigger's label, else the configured default.
   *
   * @param page - Page value.
   * @returns The `detectCurrentModel` result.
   * @example
   * ```ts
   * const result = await provider.detectCurrentModel(page);
   * ```
   */
  const detectCurrentModel = async (page: Page): Promise<string> => {
    const selector = profile.selectors.modelTrigger;
    if (!selector) return defaultModel;
    const raw = await page
      .locator(selector)
      .first()
      .innerText()
      .catch(() => "");
    const label = firstLine(raw);
    return label && isLikelyModelLabel(label) ? label : defaultModel;
  };

  /**
   * List the models offered by the picker (best-effort; opens then closes the menu).
   *
   * @param page - Page value.
   * @returns The `listAvailableModels` result.
   * @example
   * ```ts
   * const result = await provider.listAvailableModels(page);
   * ```
   */
  const listAvailableModels = async (page: Page): Promise<ModelOption[]> => {
    const optionSelector = profile.selectors.modelOption;
    if (!optionSelector || !(await openModelPicker(page))) return [];
    const options = page.locator(optionSelector);
    const total = Math.min(await options.count().catch(() => 0), 30);
    const models: ModelOption[] = [];
    for (let index = 0; index < total; index += 1) {
      const option = options.nth(index);
      const label = firstLine(await option.innerText().catch(() => ""));
      if (!label) continue;
      const checked = await option.getAttribute("aria-checked").catch(() => null);
      const selected = await option.getAttribute("aria-selected").catch(() => null);
      models.push({ id: label, label, selected: checked === "true" || selected === "true" });
    }
    await page.keyboard.press("Escape").catch(() => undefined);
    return models;
  };

  /**
   * Switch model by clicking the picker option whose label contains `query`.
   *
   * @param page - Page value.
   * @param query - Query text for the method.
   * @returns The `selectModel` result.
   * @example
   * ```ts
   * const result = await provider.selectModel(page, query);
   * ```
   */
  const selectModel = async (page: Page, query: string): Promise<string> => {
    const optionSelector = profile.selectors.modelOption;
    if (!optionSelector || !(await openModelPicker(page))) return defaultModel;
    const target = page.locator(optionSelector).filter({ hasText: query }).first();
    const clicked = await target
      .click({ timeout: 4_000 })
      .then(() => true)
      .catch(() => false);
    if (!clicked) {
      await page.keyboard.press("Escape").catch(() => undefined);
      throw new Error(`${displayName}: no model matching "${query}".`);
    }
    await page.waitForTimeout(600).catch(() => undefined);
    return detectCurrentModel(page);
  };

  /** Open the model picker via `modelTrigger`; returns false when unavailable. */
  const openModelPicker = async (page: Page): Promise<boolean> => {
    const trigger = profile.selectors.modelTrigger;
    if (!trigger) return false;
    const opened = await page
      .locator(trigger)
      .first()
      .click({ timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (opened) await page.waitForTimeout(500).catch(() => undefined);
    return opened;
  };

  /**
   * Prompt rewind is not supported generically.
   *
   * @returns Completes when `rewindLastUserPrompt` finishes.
   * @example
   * ```ts
   * await provider.rewindLastUserPrompt();
   * ```
   */
  const rewindLastUserPrompt = async (): Promise<void> => {
    throw new Error(`${displayName}: rewinding the last prompt is not supported.`);
  };

  /**
   * Click the stop-generating control if the profile defines one.
   *
   * @param page - Page value.
   * @param timeout - Timeout value.
   * @returns The `stopGenerating` result.
   * @example
   * ```ts
   * const result = await provider.stopGenerating(page, timeout);
   * ```
   */
  const stopGenerating = async (page: Page, timeout = 5_000): Promise<boolean> => {
    if (!profile.selectors.stop) return false;
    const stop = page.locator(profile.selectors.stop).first();
    const visible = await stop.isVisible({ timeout }).catch(() => false);
    if (!visible) return false;
    await stop.click({ timeout }).catch(() => undefined);
    return true;
  };

  /**
   * Attach local files by setting them on the provider's file input (`attach` selector).
   *
   * @param page - Page value.
   * @param paths - Paths value.
   * @returns Completes when `attachFilesToPrompt` finishes.
   * @example
   * ```ts
   * await provider.attachFilesToPrompt(page, paths);
   * ```
   */
  const attachFilesToPrompt = async (page: Page, paths: string[]): Promise<void> => {
    const selector = profile.selectors.attach;
    if (!selector) throw new Error(`${displayName}: attaching files is not supported.`);
    await page.locator(selector).first().setInputFiles(paths);
  };

  /**
   * Delegate MCP connector setup to the injected provider-specific flow, if any.
   *
   * @param page - Page value.
   * @param url - Url value.
   * @param options - Options that configure the method.
   * @returns The `setupMcpConnector` result.
   * @example
   * ```ts
   * const result = await provider.setupMcpConnector(page, url, options);
   * ```
   */
  const setupMcpConnector = async (
    page: Page,
    url: string,
    options?: ConnectorSetupOptions,
  ): Promise<ConnectorSetupResult> => {
    if (!connectorSetup) {
      return {
        connectorUrl: url,
        completed: false,
        steps: [],
        warnings: [`${displayName} has no MCP connector setup wired.`],
      };
    }
    return connectorSetup(page, url, options);
  };

  /**
   * Heuristic: a short label containing a known model keyword.
   *
   * @param value - Value value.
   * @returns Whether the condition matches.
   * @example
   * ```ts
   * const result = provider.isLikelyModelLabel(value);
   * ```
   */
  const isLikelyModelLabel = (value: string): boolean => {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed || trimmed.length > 40) return false;
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
