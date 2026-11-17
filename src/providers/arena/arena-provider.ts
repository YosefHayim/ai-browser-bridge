import type { Page } from "playwright";
import { DEFAULT_ASK_TIMEOUT_SECONDS } from "@/app-defaults.ts";
import type { ModelOption } from "@/connector-types.ts";
import { PROVIDER_SETTINGS } from "@/provider-settings.ts";
import {
  ARENA_MODE_LABELS,
  ARENA_MODE_URLS,
  type ArenaMode,
  parseArenaMode,
  readArenaModeFromUrl,
} from "@/providers/arena/arena-modes.ts";
import {
  ARENA_CHECK_TIMEOUT_MILLISECONDS,
  ARENA_CLICK_TIMEOUT_MILLISECONDS,
  ARENA_CONTROL_CLICK_TIMEOUT_MILLISECONDS,
  ARENA_QUICK_SETTLE_MILLISECONDS,
  ARENA_SETTLE_MILLISECONDS,
  MODE_SWITCH_SETTLE_MILLISECONDS,
  MODEL_NAME_RE,
  millisecondsPerSecond,
  minimumReplyWaitMilliseconds,
  modelSearchSettleMilliseconds,
  PROSE_SELECTOR,
  ROUNDED_CARD_SELECTOR,
  SELECTORS,
  streamCheckIntervalMilliseconds,
  WAIT_TIMEOUT_MILLISECONDS,
} from "@/providers/arena/arena-selectors.ts";
import type {
  BrowserProvider,
  ProviderProfile,
  ReplyWaitSettings,
} from "@/providers/engine/browser-provider.ts";
import { probeOrFallback, readVisibleCopy } from "@/providers/engine/browser-provider.ts";
import { ESCAPE_KEY, HTML_PARSED_WAIT, readFirstLine } from "@/providers/engine/page-probes.ts";
import { createStallReloadWatchdog } from "@/providers/engine/render-stall-watchdog.ts";
import { waitForReplyIdle } from "@/providers/engine/streaming-guard.ts";

function readChosenWaitSettings(waitSettings?: number | ReplyWaitSettings): ReplyWaitSettings {
  const isWaitTypeNumber = typeof waitSettings === "number";
  if (isWaitTypeNumber) return { timeout: waitSettings };

  const isWaitSettingsMissing = waitSettings == null;
  if (isWaitSettingsMissing) return {};

  return waitSettings;
}

function readLabelKey(label: string): string {
  return label.trim().toLowerCase();
}

const arenaSettings = PROVIDER_SETTINGS.arena;

export const arenaProfile = {
  id: "arena",
  origin: arenaSettings.origin,
  defaultUrl: ARENA_MODE_URLS.direct,
  defaultModel: arenaSettings.defaultModel,
  displayName: arenaSettings.displayName,
  composerSelector: SELECTORS.composer,
  supportsMcpConnector: false,
} satisfies ProviderProfile;

export class ArenaProvider implements BrowserProvider {
  readonly profile = arenaProfile;

  constructor(private readonly page: Page) {}

  private isGenerating = async (): Promise<boolean> => {
    const pageCopy = await probeOrFallback("", () => readVisibleCopy(this.page.locator("body")));

    const isGeneratingShown = /Generating/i.test(pageCopy);
    if (isGeneratingShown) return true;

    // Battle cards keep "Option A Generating..." in the header while streaming.
    const busyCardCount = await probeOrFallback(0, () =>
      this.page
        .locator(ROUNDED_CARD_SELECTOR)
        .filter({ hasText: /Generating/i })
        .count(),
    );
    return busyCardCount > 0;
  };

  private hasVoteControls = async (): Promise<boolean> => {
    const voteCount = await probeOrFallback(0, () =>
      this.page
        .locator('button[aria-label="A is better"], button[aria-label="B is better"]')
        .count(),
    );
    return voteCount > 0;
  };

  // Arena mounts a hidden + visible mode combobox; prefer the visible one.
  private readVisibleModeTrigger = () => {
    return this.page
      .locator(SELECTORS.modeTrigger)
      .filter({ hasText: /Battle|Direct|Agent|Side/i })
      .last();
  };

  // Side by Side shows two model triggers, so the first visible one is used.
  private readModelTrigger = () => {
    return this.page
      .locator("button:visible")
      .filter({ hasText: MODEL_NAME_RE })
      .filter({ hasNotText: /Battle|Direct|Agent|Side by Side|New Chat|Add files|Hide/i })
      .first();
  };

  assertSignedIn = async (): Promise<void> => {
    // Reused tabs can sit on Agent or a dead chat with no composer, so the Direct home is opened.
    let composerCount = await probeOrFallback(0, () =>
      this.page.locator(arenaProfile.composerSelector).count(),
    );

    const isComposerMissing = composerCount === 0;
    if (isComposerMissing) {
      await this.page.goto(arenaProfile.defaultUrl, { waitUntil: HTML_PARSED_WAIT });
      await probeOrFallback(null, () =>
        this.page.waitForSelector(arenaProfile.composerSelector, {
          timeout: WAIT_TIMEOUT_MILLISECONDS,
        }),
      );
      composerCount = await probeOrFallback(0, () =>
        this.page.locator(arenaProfile.composerSelector).count(),
      );
    }

    const isComposerCountZero = composerCount === 0;
    if (isComposerCountZero) {
      throw new Error(
        `${arenaProfile.displayName}: composer not found — open ${arenaProfile.defaultUrl} (or switch mode) and try again.`,
      );
    }
  };

  injectPrompt = async (prompt: string): Promise<void> => {
    await waitForReplyIdle(this.page, "");
    // Drain a prior "Generating…" state when present (Arena has no stable Stop control).
    const maxStreamChecks = 30;

    for (let attempt = 0; attempt < maxStreamChecks; attempt += 1) {
      const isStillGenerating = await this.isGenerating();

      const isGenerationDone = !isStillGenerating;

      if (isGenerationDone) break;

      await probeOrFallback(null, () => this.page.waitForTimeout(streamCheckIntervalMilliseconds));
    }
    const composer = this.page
      .locator(arenaProfile.composerSelector)
      .filter({ visible: true })
      .first();
    const composerClickTimeoutMilliseconds = 8_000;

    await composer.click({ timeout: composerClickTimeoutMilliseconds });
    try {
      await composer.fill(prompt);
    } catch {
      // Some composers reject fill but accept typed keys, so typing is the fallback.
      await composer.pressSequentially(prompt);
    }

    const sent = await probeOrFallback(false, async () => {
      await this.page
        .locator(SELECTORS.send)
        .first()
        .click({ timeout: ARENA_CLICK_TIMEOUT_MILLISECONDS });
      return true;
    });

    const isNotSent = !sent;
    if (isNotSent) await probeOrFallback(null, () => this.page.keyboard.press("Enter"));
  };

  waitForReply = async (waitSettings?: number | ReplyWaitSettings): Promise<void> => {
    const chosenSettings = readChosenWaitSettings(waitSettings);

    const timeoutMilliseconds =
      chosenSettings.timeout ?? DEFAULT_ASK_TIMEOUT_SECONDS * millisecondsPerSecond;

    const previousReply = chosenSettings.previousLastAssistantText ?? "";

    const deadline = Date.now() + timeoutMilliseconds;
    // Wait until generation starts or text diverges from the previous turn.
    while (Date.now() < deadline) {
      const isPageGenerating = await this.isGenerating();
      if (isPageGenerating) break;

      const currentReply = await probeOrFallback("", () => this.captureLastReply());

      const hasNewReply = currentReply.length > 0 && currentReply !== previousReply;
      if (hasNewReply) break;

      const replyPollIntervalMilliseconds = 300;

      await probeOrFallback(null, () => this.page.waitForTimeout(replyPollIntervalMilliseconds));
    }
    const remainingDeadlineMilliseconds = Math.max(
      minimumReplyWaitMilliseconds,
      deadline - Date.now(),
    );
    await this.waitForStreamIdle(remainingDeadlineMilliseconds, previousReply);
  };

  private waitForStreamIdle = async (
    budgetMilliseconds: number,
    previousReply: string,
  ): Promise<void> => {
    const deadline = Date.now() + budgetMilliseconds;
    const watchdog = createStallReloadWatchdog({
      waitAfterReload: async (target) => {
        await probeOrFallback(null, () =>
          target.waitForSelector(arenaProfile.composerSelector, {
            timeout: WAIT_TIMEOUT_MILLISECONDS,
          }),
        );
      },
      onReload: (reloadCount) =>
        process.stderr.write(
          `[bridge] ${arenaProfile.displayName} render stalled — reloaded tab (reload ${reloadCount}).\n`,
        ),
    });
    let previousStableReply = "";
    while (Date.now() < deadline) {
      const generating = await this.isGenerating();
      const currentReply = await probeOrFallback("", () => this.captureLastReply());
      const voted = await this.hasVoteControls();

      const settled =
        currentReply.length > 0 &&
        currentReply === previousStableReply &&
        !generating &&
        currentReply !== previousReply &&
        !/Generating/i.test(currentReply);

      // Vote controls mean both battle options finished even if text still streams chrome.
      const isAnswerDone = settled || (voted && currentReply.length > 0 && !generating);
      if (isAnswerDone) return;

      const hasStableReplyChanged = currentReply !== previousStableReply;
      const isNotGenerating = !generating;
      const isStalledWhileIdle =
        !hasStableReplyChanged && isNotGenerating && (await watchdog.reloadIfStalled(this.page));

      if (hasStableReplyChanged) {
        previousStableReply = currentReply;

        const isCurrentNotEmpty = currentReply.length > 0;
        if (isCurrentNotEmpty) watchdog.noteProgress();
      } else if (isStalledWhileIdle) {
        previousStableReply = "";
        continue;
      }

      await probeOrFallback(null, () => this.page.waitForTimeout(ARENA_QUICK_SETTLE_MILLISECONDS));
    }
  };

  captureLastReply = async (): Promise<string> => {
    const pageUrl = this.page.url();
    const mode = readArenaModeFromUrl(pageUrl);

    const isComparisonMode = mode === "battle" || mode === "side-by-side";
    if (isComparisonMode) {
      const dualAnswersCopy = await this.captureDualAnswers();

      const hasDual = dualAnswersCopy != null;
      if (hasDual) return dualAnswersCopy;
    }

    const assistantCards = this.page.locator(SELECTORS.assistant);
    const assistantCardsCount = await probeOrFallback(0, () => assistantCards.count());

    const hasAssistantCards = assistantCardsCount > 0;
    if (hasAssistantCards) {
      return (await probeOrFallback("", () => readVisibleCopy(assistantCards.last()))).trim();
    }

    // Direct sometimes renders assistant prose without the battle card chrome.
    const proseBlocks = this.page.locator(SELECTORS.assistantFallback);
    const proseBlockCopies = await probeOrFallback([], () => proseBlocks.allInnerTexts());
    const userPrompts = await probeOrFallback([], () =>
      this.page.locator(SELECTORS.user).allInnerTexts(),
    );
    const trimmedUserPrompts = userPrompts.map((userPrompt) => userPrompt.trim());
    const userSet = new Set(trimmedUserPrompts);
    const assistantReplies = proseBlockCopies
      .map((prose) => prose.trim())
      .filter((trimmedProse) => trimmedProse.length > 0 && !userSet.has(trimmedProse));
    const lastAssistant = assistantReplies[assistantReplies.length - 1];

    const isLastAssistantMissing = lastAssistant == null;
    if (isLastAssistantMissing) return "";

    return lastAssistant;
  };

  private captureDualAnswers = async (): Promise<string | null> => {
    // Prefer cards that already have a prose body; fall back to any Option A/B shell.
    let cards = this.page
      .locator(ROUNDED_CARD_SELECTOR)
      .filter({ has: this.page.locator(PROSE_SELECTOR) });

    let cardCount = await probeOrFallback(0, () => cards.count());

    const isNoCardFound = cardCount < 1;
    if (isNoCardFound) {
      cards = this.page.locator(ROUNDED_CARD_SELECTOR).filter({ hasText: /Option\s*[AB]/i });
      cardCount = await probeOrFallback(0, () => cards.count());
    }

    const hasNoCards = cardCount < 1;
    if (hasNoCards) return null;

    const labeledAnswers: string[] = [];
    const maxCompareCardCount = 2;

    for (let index = 0; index < Math.min(cardCount, maxCompareCardCount); index += 1) {
      const card = cards.nth(index);

      const cardLabel = await probeOrFallback("", () => readVisibleCopy(card));
      const cardCopy = cardLabel.trim();

      const isCardPending = cardCopy.length === 0 || /Generating/i.test(cardCopy);
      if (isCardPending) continue;

      const prose = (
        await probeOrFallback("", () => readVisibleCopy(card.locator(PROSE_SELECTOR).first()))
      ).trim();

      const isProseEmpty = prose.length === 0;
      const answerCopy = isProseEmpty ? cardCopy : prose;

      // Strip vote chrome / "Deployed the project" noise when present as trailing UI.
      const cleanedAnswerCopy = answerCopy
        .replace(/\bA is better\b[\s\S]*$/i, "")
        .replace(/\bB is better\b[\s\S]*$/i, "")
        .replace(/\bBoth are good\b[\s\S]*$/i, "")
        .trim();

      const isCleanedAnswerEmpty = cleanedAnswerCopy.length === 0;
      if (isCleanedAnswerEmpty) continue;

      const titleParts = cardCopy.match(/(?<optionTitle>Option\s*[AB])/i);

      const asciiCodeOfUpperA = 65;

      const fallbackOptionTitle = `Option ${String.fromCharCode(asciiCodeOfUpperA + index)}`;
      const optionTitle = titleParts?.groups?.optionTitle ?? fallbackOptionTitle;

      labeledAnswers.push(`${optionTitle}\n${cleanedAnswerCopy}`);
    }

    const isLabeledEmpty = labeledAnswers.length === 0;
    if (isLabeledEmpty) return null;

    const isSingleLabeledAnswer = labeledAnswers.length === 1;
    if (isSingleLabeledAnswer) {
      const onlyAnswer = labeledAnswers[0];

      const isOnlyAnswerMissing = onlyAnswer == null;
      if (isOnlyAnswerMissing) return null;

      return onlyAnswer;
    }

    return labeledAnswers.join("\n\n");
  };

  countAssistantReplies = async (): Promise<number> => {
    const cardCount = await probeOrFallback(0, () =>
      this.page.locator(SELECTORS.assistant).count(),
    );

    const hasCards = cardCount > 0;
    if (hasCards) return cardCount;

    return probeOrFallback(0, () => this.page.locator(SELECTORS.assistantFallback).count());
  };

  captureAllMessages = async (): Promise<Array<{ role: string; content: string }>> => {
    const userPrompts = await probeOrFallback([], () =>
      this.page.locator(SELECTORS.user).allInnerTexts(),
    );
    const assistantReplies = await probeOrFallback([], () =>
      this.page.locator(SELECTORS.assistant).allInnerTexts(),
    );
    const messages = [
      ...userPrompts.map((userPrompt) => ({ role: "user", content: userPrompt.trim() })),
      ...assistantReplies.map((assistantReply) => ({
        role: "assistant",
        content: assistantReply.trim(),
      })),
    ];

    return messages.filter((message) => message.content.length > 0);
  };

  readSidebarConversations = async (): Promise<
    Array<{ id: string; title: string; url: string }>
  > => {
    const links = this.page.locator(SELECTORS.sidebarItem);
    const maxLinkCount = 40;

    const linkCount = await probeOrFallback(0, () => links.count());
    const total = Math.min(linkCount, maxLinkCount);
    const conversations: Array<{ id: string; title: string; url: string }> = [];
    for (let index = 0; index < total; index += 1) {
      const link = links.nth(index);

      const href = await probeOrFallback(null, () => link.getAttribute("href"));

      const isHrefBlank = href === null || href.length === 0;
      if (isHrefBlank) continue;

      const conversationUrl = new URL(href, `https://${origin}`).toString();
      const linkTitle = readFirstLine(await probeOrFallback("", () => readVisibleCopy(link)));
      const pathSegment = href.split("/").filter(Boolean).pop();
      const conversationId = pathSegment ?? href;

      const isLinkTitleEmpty = linkTitle.length === 0;
      const conversationTitle = isLinkTitleEmpty ? conversationId : linkTitle;

      conversations.push({
        id: conversationId,
        title: conversationTitle,
        url: conversationUrl,
      });
    }
    return conversations;
  };

  navigateToConversation = async (conversationUrl: string): Promise<void> => {
    await this.page.goto(conversationUrl, { waitUntil: HTML_PARSED_WAIT });
  };

  newConversation = async (): Promise<void> => {
    const pageUrl = this.page.url();
    const mode = readArenaModeFromUrl(pageUrl);
    const modeHomeUrl = ARENA_MODE_URLS[mode];

    const clicked = await probeOrFallback(false, async () => {
      await this.page
        .locator(SELECTORS.newChat)
        .first()
        .click({ timeout: ARENA_CHECK_TIMEOUT_MILLISECONDS });
      return true;
    });

    const isNotClicked = !clicked;
    if (isNotClicked) await this.page.goto(modeHomeUrl, { waitUntil: HTML_PARSED_WAIT });

    await probeOrFallback(null, () =>
      this.page.waitForSelector(arenaProfile.composerSelector, {
        timeout: WAIT_TIMEOUT_MILLISECONDS,
      }),
    );
  };

  detectCurrentModel = async (): Promise<string> => {
    const triggerLabel = await probeOrFallback("", () => readVisibleCopy(this.readModelTrigger()));

    const modelLabel = readFirstLine(triggerLabel);

    const isModelLabelUsable = modelLabel.length > 0 && this.isLikelyModelLabel(modelLabel);
    if (isModelLabelUsable) return modelLabel;

    return arenaProfile.defaultModel;
  };

  listAvailableModels = async (): Promise<ModelOption[]> => {
    const isModelPickerNotOpened = !(await this.openModelPicker());
    if (isModelPickerNotOpened) return [];

    const modelChoices = this.page.locator(SELECTORS.modelOption);
    const maxModelChoiceCount = 80;

    const modelChoiceCount = await probeOrFallback(0, () => modelChoices.count());
    const total = Math.min(modelChoiceCount, maxModelChoiceCount);
    const models: ModelOption[] = [];
    const seenLabels = new Set<string>();
    for (let index = 0; index < total; index += 1) {
      const modelChoice = modelChoices.nth(index);

      const label = readFirstLine(await probeOrFallback("", () => readVisibleCopy(modelChoice)));

      const isLabelSkipped = label.length === 0 || seenLabels.has(label);
      if (isLabelSkipped) continue;

      // Skip mode-picker rows if the wrong menu is open.
      const isArenaModeLabel = /^(Battle Mode|Agent Mode|Side by Side|Direct)\b/i.test(label);
      if (isArenaModeLabel) continue;

      seenLabels.add(label);
      const selectedAttribute = await probeOrFallback(null, () =>
        modelChoice.getAttribute("data-selected"),
      );
      const ariaSelected = await probeOrFallback(null, () =>
        modelChoice.getAttribute("aria-selected"),
      );
      const selected = selectedAttribute === "true" || ariaSelected === "true";
      models.push({ id: label, label, selected });
    }
    await probeOrFallback(null, () => this.page.keyboard.press(ESCAPE_KEY));
    return models;
  };

  // Model queries open Search models and click the matching option.
  selectModel = async (query: string): Promise<string> => {
    const mode = parseArenaMode(query);

    const hasMode = mode != null;
    if (hasMode) {
      await this.setMode(mode);
      return ARENA_MODE_LABELS[mode];
    }

    // Support "direct/glm-5.1" or "battle+..." — mode prefix then model.
    const modeModelTokens = query.split(/[/+:]/);
    const pairedModelCount = 2;

    const isPairedModelTokens = modeModelTokens.length === pairedModelCount;
    if (isPairedModelTokens) {
      const modeToken = modeModelTokens[0];

      const modelToken = modeModelTokens[1];

      const hasModeToken = modeToken != null && modelToken != null;
      if (hasModeToken) {
        const maybeMode = parseArenaMode(modeToken);

        const hasMaybeMode = maybeMode != null;
        if (hasMaybeMode) {
          await this.setMode(maybeMode);
          return this.selectModelByName(modelToken);
        }
      }
    }

    return this.selectModelByName(query);
  };

  private setMode = async (mode: ArenaMode): Promise<void> => {
    const targetUrl = ARENA_MODE_URLS[mode];
    const pageUrl = this.page.url();

    const currentMode = readArenaModeFromUrl(pageUrl);
    const isModeMatching = currentMode === mode;
    const targetPathname = new URL(targetUrl).pathname;
    const isTargetPathInUrl = this.page.url().includes(targetPathname);

    const isOnTargetArenaPage = isModeMatching && isTargetPathInUrl;
    if (isOnTargetArenaPage) {
      return;
    }

    // Prefer direct navigation — reliable and skips hidden combobox clones.
    await this.page.goto(targetUrl, { waitUntil: HTML_PARSED_WAIT });
    await probeOrFallback(null, () => this.page.waitForTimeout(MODE_SWITCH_SETTLE_MILLISECONDS));

    // If still wrong (redirect), try the mode combobox on a code surface.
    const currentPageUrl = this.page.url();

    const isArenaModeWrong = readArenaModeFromUrl(currentPageUrl) !== mode;
    if (isArenaModeWrong) {
      await this.page.goto(ARENA_MODE_URLS.battle, { waitUntil: HTML_PARSED_WAIT });
      await probeOrFallback(null, () => this.page.waitForTimeout(ARENA_SETTLE_MILLISECONDS));
      const trigger = this.readVisibleModeTrigger();
      await trigger.click({ timeout: ARENA_CONTROL_CLICK_TIMEOUT_MILLISECONDS });
      await this.page
        .locator(SELECTORS.modeOption)
        .filter({ hasText: new RegExp(`^${ARENA_MODE_LABELS[mode]}`, "i") })
        .first()
        .click({ timeout: ARENA_CONTROL_CLICK_TIMEOUT_MILLISECONDS });
      await probeOrFallback(null, () => this.page.waitForTimeout(MODE_SWITCH_SETTLE_MILLISECONDS));
    }

    await probeOrFallback(null, () =>
      this.page.waitForSelector(arenaProfile.composerSelector, {
        timeout: WAIT_TIMEOUT_MILLISECONDS,
      }),
    );
  };

  private selectModelByName = async (query: string): Promise<string> => {
    const isModelPickerNotOpened = !(await this.openModelPicker());
    if (isModelPickerNotOpened) {
      throw new Error(
        `${arenaProfile.displayName}: model picker is not available on this surface.`,
      );
    }

    const search = this.page.locator(SELECTORS.modelSearch).first();
    const visibilityTimeoutMilliseconds = 2_000;

    const isSearchVisible = await probeOrFallback(false, () =>
      search.isVisible({ timeout: visibilityTimeoutMilliseconds }),
    );
    if (isSearchVisible) {
      await search.fill(query);
      await probeOrFallback(null, () => this.page.waitForTimeout(modelSearchSettleMilliseconds));
    }

    const needle = readLabelKey(query);
    const modelChoices = this.page.locator(SELECTORS.modelOption);
    const total = await probeOrFallback(0, () => modelChoices.count());
    let clicked = false;
    for (let index = 0; index < total; index += 1) {
      const modelChoice = modelChoices.nth(index);
      const label = readFirstLine(await probeOrFallback("", () => readVisibleCopy(modelChoice)));

      const isLabelEmpty = label.length === 0;
      if (isLabelEmpty) continue;

      const normalizedMenuLabel = readLabelKey(label);

      const isMenuLabelFound =
        normalizedMenuLabel === needle || normalizedMenuLabel.includes(needle);
      if (isMenuLabelFound) {
        await modelChoice.click({ timeout: ARENA_CLICK_TIMEOUT_MILLISECONDS });
        clicked = true;
        break;
      }
    }

    const isNotClicked = !clicked;
    if (isNotClicked) {
      await probeOrFallback(null, () => this.page.keyboard.press(ESCAPE_KEY));
      throw new Error(`${arenaProfile.displayName}: no model matching "${query}".`);
    }

    await probeOrFallback(null, () => this.page.waitForTimeout(ARENA_SETTLE_MILLISECONDS));
    await probeOrFallback(null, () => this.page.keyboard.press(ESCAPE_KEY));
    return this.detectCurrentModel();
  };

  private openModelPicker = async (): Promise<boolean> => {
    const trigger = this.readModelTrigger();

    const opened = await probeOrFallback(false, async () => {
      await trigger.click({ timeout: ARENA_CONTROL_CLICK_TIMEOUT_MILLISECONDS });
      return true;
    });

    const isNotOpened = !opened;
    if (isNotOpened) return false;

    await probeOrFallback(null, () => this.page.waitForTimeout(ARENA_QUICK_SETTLE_MILLISECONDS));
    const ready = await probeOrFallback(false, () =>
      this.page
        .locator(`${SELECTORS.modelSearch}, ${SELECTORS.modelOption}`)
        .first()
        .isVisible({ timeout: ARENA_CHECK_TIMEOUT_MILLISECONDS }),
    );
    return ready;
  };

  // Rewind is not supported on Arena.
  rewindLastUserPrompt = async (): Promise<void> => {
    throw new Error(`${arenaProfile.displayName}: rewinding the last prompt is not supported.`);
  };

  // Arena exposes no stable stop control — always returns false.
  stopGenerating = async (
    _timeout = ARENA_CONTROL_CLICK_TIMEOUT_MILLISECONDS,
  ): Promise<boolean> => {
    return false;
  };

  attachFilesToPrompt = async (paths: string[]): Promise<void> => {
    await this.page.locator(SELECTORS.attach).first().setInputFiles(paths);
  };

  // Arena model labels are free-form ids (glm-5.1, Max, gpt-5.3-codex, …).
  isLikelyModelLabel = (label: string): boolean => {
    const trimmed = label.trim();
    const maxModelLabelLength = 60;

    const isTitleUnusable = trimmed.length === 0 || trimmed.length > maxModelLabelLength;
    if (isTitleUnusable) return false;

    const isArenaModeKnown = parseArenaMode(trimmed) != null;
    if (isArenaModeKnown) return true;

    return MODEL_NAME_RE.test(trimmed) || /[-._0-9]/.test(trimmed);
  };
}
