import type { Page } from "playwright";
import { DEFAULT_ASK_TIMEOUT_SECONDS, PROVIDER_SETTINGS } from "@/config";
import type { ModelOption } from "@/domain/connector-types.ts";
import type { BrowserProvider, ReplyWaitSettings } from "@/providers/browser-provider.ts";
import { probeOrFallback, readVisibleText } from "@/providers/browser-provider.ts";
import { createStallReloadWatchdog } from "@/providers/render-stall-watchdog.ts";
import { waitForReplyIdle } from "@/providers/streaming-guard.ts";
import {
  ARENA_MODE_LABELS,
  ARENA_MODE_URLS,
  type ArenaMode,
  parseArenaMode,
  readArenaModeFromUrl,
} from "./arena-modes.ts";

const ARENA_CONTROL_CLICK_TIMEOUT_MILLISECONDS = 5_000;

const ARENA_SETTLE_MILLISECONDS = 600;

const MODE_SWITCH_SETTLE_MILLISECONDS = 800;

const ARENA_CHECK_TIMEOUT_MILLISECONDS = 3_000;

const ARENA_QUICK_SETTLE_MILLISECONDS = 400;

const millisecondsPerSecond = 1000;

const minimumReplyWaitMilliseconds = 1000;

const ARENA_CLICK_TIMEOUT_MILLISECONDS = 4_000;

const streamCheckIntervalMilliseconds = 500;

const modelSearchSettleMilliseconds = 500;

const WAIT_TIMEOUT_MILLISECONDS = 15_000;

const PROFILE = PROVIDER_SETTINGS.arena;

const SELECTORS = {
  composer:
    'textarea[name="message"], [contenteditable="true"][role="textbox"], [contenteditable="true"]',
  send: 'button[aria-label="Send message"]',
  // Battle / Direct assistant prose lives in option cards; user bubble is raised/self-end.
  assistant: "div.rounded-xl .prose",
  assistantFallback: ".prose",
  user: ".bg-surface-raised .prose, .self-end .prose",
  newChat: 'a[href="/code"], a[href$="/code"], a[href*="/direct"], a[href*="/agent"]',
  sidebarItem: 'a[href*="/c/"]',
  // Mode combobox shows Battle Mode / Direct / … (hidden + visible clones exist).
  modeTrigger: 'button[role="combobox"]',
  modeOption: '[role="option"]',
  // Model trigger is a plain button labeled Max / glm-5.1 / … (not the mode combobox).
  modelSearch: 'input[placeholder="Search models"]',
  modelOption: '[role="option"]',
  attach: 'input[type="file"]',
} as const;

const MODEL_NAME_RE =
  /^(Max|gemini|glm|qwen|claude|gpt|kimi|minimax|deepseek|llama|mistral|sonar|o[13]|codex|flash|sonnet|opus|haiku)/i;

const readFirstLine = (lines: string): string => {
  const line = lines.trim().split("\n")[0];

  const isLineMissing = line === undefined;
  if (isLineMissing) return "";

  return line.trim();
};

const readLabelKey = (label: string): string => label.trim().toLowerCase();

const isGenerating = async (page: Page): Promise<boolean> => {
  const pageCopy = await probeOrFallback("", () => readVisibleText(page.locator("body")));

  const isGeneratingShown = /Generating/i.test(pageCopy);
  if (isGeneratingShown) return true;

  // Battle cards keep "Option A Generating..." in the header while streaming.
  const busyCardCount = await probeOrFallback(0, () =>
    page
      .locator("div.rounded-xl")
      .filter({ hasText: /Generating/i })
      .count(),
  );
  return busyCardCount > 0;
};

const hasVoteControls = async (page: Page): Promise<boolean> => {
  const voteCount = await probeOrFallback(0, () =>
    page.locator('button[aria-label="A is better"], button[aria-label="B is better"]').count(),
  );
  return voteCount > 0;
};

// Arena mounts a hidden + visible mode combobox; prefer the visible one.
const readVisibleModeTrigger = (page: Page) => {
  return page
    .locator(SELECTORS.modeTrigger)
    .filter({ hasText: /Battle|Direct|Agent|Side/i })
    .last();
};

// Side by Side shows two model triggers, so the first visible one is used.
const readModelTrigger = (page: Page) => {
  return page
    .locator("button:visible")
    .filter({ hasText: MODEL_NAME_RE })
    .filter({ hasNotText: /Battle|Direct|Agent|Side by Side|New Chat|Add files|Hide/i })
    .first();
};

const id = "arena";
const origin = PROFILE.origin;
const defaultUrl = ARENA_MODE_URLS.direct;
const defaultModel = PROFILE.defaultModel;
const displayName = PROFILE.displayName;
const composerSelector = SELECTORS.composer;
const supportsMcpConnector = false;

const assertSignedIn = async (page: Page): Promise<void> => {
  // Reused tabs can sit on Agent or a dead chat with no composer, so the Direct home is opened.
  let composerCount = await probeOrFallback(0, () => page.locator(composerSelector).count());

  const isComposerMissing = composerCount === 0;
  if (isComposerMissing) {
    await page.goto(defaultUrl, { waitUntil: "domcontentloaded" });
    await probeOrFallback(null, () =>
      page.waitForSelector(composerSelector, { timeout: WAIT_TIMEOUT_MILLISECONDS }),
    );
    composerCount = await probeOrFallback(0, () => page.locator(composerSelector).count());
  }

  const isComposerCountZero = composerCount === 0;
  if (isComposerCountZero) {
    throw new Error(
      `${displayName}: composer not found — open ${defaultUrl} (or switch mode) and try again.`,
    );
  }
};

const injectPrompt = async (page: Page, prompt: string): Promise<void> => {
  await waitForReplyIdle(page, "");
  // Drain a prior "Generating…" state when present (Arena has no stable Stop control).
  const maxStreamChecks = 30;

  for (let attempt = 0; attempt < maxStreamChecks; attempt += 1) {
    const isStillGenerating = await isGenerating(page);

    const isGenerationDone = !isStillGenerating;

    if (isGenerationDone) break;

    await probeOrFallback(null, () => page.waitForTimeout(streamCheckIntervalMilliseconds));
  }
  const composer = page.locator(composerSelector).filter({ visible: true }).first();
  const composerClickTimeoutMilliseconds = 8_000;

  await composer.click({ timeout: composerClickTimeoutMilliseconds });
  const composerTag = await probeOrFallback("textarea", () =>
    composer.evaluate((element) => element.tagName.toLowerCase()),
  );

  const isComposerTagTextarea = composerTag === "textarea";
  if (isComposerTagTextarea) {
    await composer.fill(prompt);
  } else {
    await page.keyboard.press("Meta+A").catch(() => page.keyboard.press("Control+A"));
    const typingDelayMilliseconds = 5;

    await page.keyboard.type(prompt, { delay: typingDelayMilliseconds });
  }

  const sent = await probeOrFallback(false, async () => {
    await page.locator(SELECTORS.send).first().click({ timeout: ARENA_CLICK_TIMEOUT_MILLISECONDS });
    return true;
  });

  const isNotSent = !sent;
  if (isNotSent) await probeOrFallback(null, () => page.keyboard.press("Enter"));
};

const waitForReply = async (
  page: Page,
  waitSettings?: number | ReplyWaitSettings,
): Promise<void> => {
  let chosenSettings: ReplyWaitSettings = {};

  const isWaitTypeNumber = typeof waitSettings === "number";
  if (isWaitTypeNumber) {
    chosenSettings = { timeout: waitSettings };
  } else if (waitSettings !== undefined) {
    chosenSettings = waitSettings;
  }

  const timeoutMs = chosenSettings.timeout ?? DEFAULT_ASK_TIMEOUT_SECONDS * millisecondsPerSecond;

  let previousReply = "";

  if (chosenSettings.previousLastAssistantText !== undefined) {
    previousReply = chosenSettings.previousLastAssistantText;
  }

  const deadline = Date.now() + timeoutMs;
  // Wait until generation starts or text diverges from the previous turn.
  while (Date.now() < deadline) {
    const isPageGenerating = await isGenerating(page);
    if (isPageGenerating) break;

    const currentReply = await probeOrFallback("", () => captureLastReply(page));

    const hasNewReply = currentReply.length > 0 && currentReply !== previousReply;
    if (hasNewReply) break;

    const replyPollIntervalMilliseconds = 300;

    await probeOrFallback(null, () => page.waitForTimeout(replyPollIntervalMilliseconds));
  }
  const remainingDeadlineMilliseconds = Math.max(
    minimumReplyWaitMilliseconds,
    deadline - Date.now(),
  );
  await waitForStreamIdle(page, remainingDeadlineMilliseconds, previousReply);
};

const waitForStreamIdle = async (
  page: Page,
  budgetMs: number,
  previousReply: string,
): Promise<void> => {
  const deadline = Date.now() + budgetMs;
  const watchdog = createStallReloadWatchdog({
    waitAfterReload: async (target) => {
      await probeOrFallback(null, () =>
        target.waitForSelector(composerSelector, { timeout: WAIT_TIMEOUT_MILLISECONDS }),
      );
    },
    onReload: (reloadCount) =>
      process.stderr.write(
        `[bridge] ${displayName} render stalled — reloaded tab (reload ${reloadCount}).\n`,
      ),
  });
  let previousStableReply = "";
  while (Date.now() < deadline) {
    const generating = await isGenerating(page);
    const currentReply = await probeOrFallback("", () => captureLastReply(page));
    const voted = await hasVoteControls(page);

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

    if (hasStableReplyChanged) {
      previousStableReply = currentReply;

      const isCurrentNotEmpty = currentReply.length > 0;
      if (isCurrentNotEmpty) watchdog.noteProgress();
    } else if (isNotGenerating && (await watchdog.reloadIfStalled(page))) {
      previousStableReply = "";
      continue;
    }

    await probeOrFallback(null, () => page.waitForTimeout(ARENA_QUICK_SETTLE_MILLISECONDS));
  }
};

const captureLastReply = async (page: Page): Promise<string> => {
  const pageUrl = page.url();
  const mode = readArenaModeFromUrl(pageUrl);

  const isComparisonMode = mode === "battle" || mode === "side-by-side";
  if (isComparisonMode) {
    const dualAnswersCopy = await captureDualAnswers(page);

    const hasDual = dualAnswersCopy != null;
    if (hasDual) return dualAnswersCopy;
  }

  const assistantCards = page.locator(SELECTORS.assistant);
  const assistantCardsCount = await probeOrFallback(0, () => assistantCards.count());

  const hasAssistantCards = assistantCardsCount > 0;
  if (hasAssistantCards) {
    return (await probeOrFallback("", () => readVisibleText(assistantCards.last()))).trim();
  }

  // Direct sometimes renders assistant prose without the battle card chrome.
  const proseBlocks = page.locator(SELECTORS.assistantFallback);
  const proseBlockCopies = await probeOrFallback([], () => proseBlocks.allInnerTexts());
  const userPrompts = await probeOrFallback([], () => page.locator(SELECTORS.user).allInnerTexts());
  const trimmedUserPrompts = userPrompts.map((userPrompt) => userPrompt.trim());
  const userSet = new Set(trimmedUserPrompts);
  const assistantReplies = proseBlockCopies
    .map((prose) => prose.trim())
    .filter((trimmedProse) => trimmedProse.length > 0 && !userSet.has(trimmedProse));
  const lastAssistant = assistantReplies[assistantReplies.length - 1];

  const isLastAssistantMissing = lastAssistant === undefined;
  if (isLastAssistantMissing) return "";

  return lastAssistant;
};

const captureDualAnswers = async (page: Page): Promise<string | null> => {
  // Prefer cards that already have a prose body; fall back to any Option A/B shell.
  let cards = page.locator("div.rounded-xl").filter({ has: page.locator(".prose") });

  let cardCount = await probeOrFallback(0, () => cards.count());

  const isNoCardFound = cardCount < 1;
  if (isNoCardFound) {
    cards = page.locator("div.rounded-xl").filter({ hasText: /Option\s*[AB]/i });
    cardCount = await probeOrFallback(0, () => cards.count());
  }

  const hasNoCards = cardCount < 1;
  if (hasNoCards) return null;

  const labeledAnswers: string[] = [];
  const maxCompareCardCount = 2;

  for (let index = 0; index < Math.min(cardCount, maxCompareCardCount); index += 1) {
    const card = cards.nth(index);

    const cardLabel = await probeOrFallback("", () => readVisibleText(card));
    const cardCopy = cardLabel.trim();

    const isCardPending = cardCopy.length === 0 || /Generating/i.test(cardCopy);
    if (isCardPending) continue;

    const prose = (
      await probeOrFallback("", () => readVisibleText(card.locator(".prose").first()))
    ).trim();

    let answerCopy = prose;

    const isAnswerEmpty = answerCopy.length === 0;
    if (isAnswerEmpty) answerCopy = cardCopy;

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

    let optionTitle = `Option ${String.fromCharCode(asciiCodeOfUpperA + index)}`;

    const foundOptionTitle = titleParts?.groups?.optionTitle;

    const hasOptionTitle = foundOptionTitle != null;
    if (hasOptionTitle) optionTitle = foundOptionTitle;

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

const countAssistantReplies = async (page: Page): Promise<number> => {
  const cardCount = await probeOrFallback(0, () => page.locator(SELECTORS.assistant).count());

  const hasCards = cardCount > 0;
  if (hasCards) return cardCount;

  return probeOrFallback(0, () => page.locator(SELECTORS.assistantFallback).count());
};

const captureAllMessages = async (
  page: Page,
): Promise<Array<{ role: string; content: string }>> => {
  const userPrompts = await probeOrFallback([], () => page.locator(SELECTORS.user).allInnerTexts());
  const assistantReplies = await probeOrFallback([], () =>
    page.locator(SELECTORS.assistant).allInnerTexts(),
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

const readSidebarConversations = async (
  page: Page,
): Promise<Array<{ id: string; title: string; url: string }>> => {
  const links = page.locator(SELECTORS.sidebarItem);
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
    const linkTitle = readFirstLine(await probeOrFallback("", () => readVisibleText(link)));
    const pathSegment = href.split("/").filter(Boolean).pop();
    let conversationId = href;

    const hasPathSegment = pathSegment !== undefined;
    if (hasPathSegment) conversationId = pathSegment;

    let conversationTitle = linkTitle;

    const isConversationTitleEmpty = conversationTitle.length === 0;
    if (isConversationTitleEmpty) conversationTitle = conversationId;

    conversations.push({
      id: conversationId,
      title: conversationTitle,
      url: conversationUrl,
    });
  }
  return conversations;
};

const navigateToConversation = async (page: Page, conversationUrl: string): Promise<void> => {
  await page.goto(conversationUrl, { waitUntil: "domcontentloaded" });
};

const startNewConversation = async (page: Page): Promise<void> => {
  const pageUrl = page.url();
  const mode = readArenaModeFromUrl(pageUrl);
  const modeHomeUrl = ARENA_MODE_URLS[mode];

  const clicked = await probeOrFallback(false, async () => {
    await page
      .locator(SELECTORS.newChat)
      .first()
      .click({ timeout: ARENA_CHECK_TIMEOUT_MILLISECONDS });
    return true;
  });

  const isNotClicked = !clicked;
  if (isNotClicked) await page.goto(modeHomeUrl, { waitUntil: "domcontentloaded" });

  await probeOrFallback(null, () =>
    page.waitForSelector(composerSelector, { timeout: WAIT_TIMEOUT_MILLISECONDS }),
  );
};

const detectCurrentModel = async (page: Page): Promise<string> => {
  const triggerLabel = await probeOrFallback("", () => readVisibleText(readModelTrigger(page)));

  const modelLabel = readFirstLine(triggerLabel);

  const isModelLabelUsable = modelLabel.length > 0 && isLikelyModelLabel(modelLabel);
  if (isModelLabelUsable) return modelLabel;

  return defaultModel;
};

const listAvailableModels = async (page: Page): Promise<ModelOption[]> => {
  const isModelPickerNotOpened = !(await openModelPicker(page));
  if (isModelPickerNotOpened) return [];

  const modelChoices = page.locator(SELECTORS.modelOption);
  const maxModelChoiceCount = 80;

  const modelChoiceCount = await probeOrFallback(0, () => modelChoices.count());
  const total = Math.min(modelChoiceCount, maxModelChoiceCount);
  const models: ModelOption[] = [];
  const seenLabels = new Set<string>();
  for (let index = 0; index < total; index += 1) {
    const modelChoice = modelChoices.nth(index);

    const label = readFirstLine(await probeOrFallback("", () => readVisibleText(modelChoice)));

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
  await probeOrFallback(null, () => page.keyboard.press("Escape"));
  return models;
};

// Model queries open Search models and click the matching option.
const selectModel = async (page: Page, query: string): Promise<string> => {
  const mode = parseArenaMode(query);

  const hasMode = mode != null;
  if (hasMode) {
    await setMode(page, mode);
    return ARENA_MODE_LABELS[mode];
  }

  // Support "direct/glm-5.1" or "battle+..." — mode prefix then model.
  const modeModelTokens = query.split(/[/+:]/);
  const pairedModelCount = 2;

  const isPairedModelTokens = modeModelTokens.length === pairedModelCount;
  if (isPairedModelTokens) {
    const modeToken = modeModelTokens[0];

    const modelToken = modeModelTokens[1];

    const hasModeToken = modeToken !== undefined && modelToken !== undefined;
    if (hasModeToken) {
      const maybeMode = parseArenaMode(modeToken);

      const hasMaybeMode = maybeMode != null;
      if (hasMaybeMode) {
        await setMode(page, maybeMode);
        return selectModelByName(page, modelToken);
      }
    }
  }

  return selectModelByName(page, query);
};

const setMode = async (page: Page, mode: ArenaMode): Promise<void> => {
  const targetUrl = ARENA_MODE_URLS[mode];
  const pageUrl = page.url();

  const currentMode = readArenaModeFromUrl(pageUrl);
  const isModeMatching = currentMode === mode;
  const targetPathname = new URL(targetUrl).pathname;
  const isTargetPathInUrl = page.url().includes(targetPathname);

  const isOnTargetArenaPage = isModeMatching && isTargetPathInUrl;
  if (isOnTargetArenaPage) {
    return;
  }

  // Prefer direct navigation — reliable and skips hidden combobox clones.
  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
  await probeOrFallback(null, () => page.waitForTimeout(MODE_SWITCH_SETTLE_MILLISECONDS));

  // If still wrong (redirect), try the mode combobox on a code surface.
  const currentPageUrl = page.url();

  const isArenaModeWrong = readArenaModeFromUrl(currentPageUrl) !== mode;
  if (isArenaModeWrong) {
    await page.goto(ARENA_MODE_URLS.battle, { waitUntil: "domcontentloaded" });
    await probeOrFallback(null, () => page.waitForTimeout(ARENA_SETTLE_MILLISECONDS));
    const trigger = readVisibleModeTrigger(page);
    await trigger.click({ timeout: ARENA_CONTROL_CLICK_TIMEOUT_MILLISECONDS });
    await page
      .locator(SELECTORS.modeOption)
      .filter({ hasText: new RegExp(`^${ARENA_MODE_LABELS[mode]}`, "i") })
      .first()
      .click({ timeout: ARENA_CONTROL_CLICK_TIMEOUT_MILLISECONDS });
    await probeOrFallback(null, () => page.waitForTimeout(MODE_SWITCH_SETTLE_MILLISECONDS));
  }

  await probeOrFallback(null, () =>
    page.waitForSelector(composerSelector, { timeout: WAIT_TIMEOUT_MILLISECONDS }),
  );
};

const selectModelByName = async (page: Page, query: string): Promise<string> => {
  const isModelPickerNotOpened = !(await openModelPicker(page));
  if (isModelPickerNotOpened) {
    throw new Error(`${displayName}: model picker is not available on this surface.`);
  }

  const search = page.locator(SELECTORS.modelSearch).first();
  const visibilityTimeoutMilliseconds = 2_000;

  const isSearchVisible = await probeOrFallback(false, () =>
    search.isVisible({ timeout: visibilityTimeoutMilliseconds }),
  );
  if (isSearchVisible) {
    await search.fill(query);
    await probeOrFallback(null, () => page.waitForTimeout(modelSearchSettleMilliseconds));
  }

  const needle = readLabelKey(query);
  const modelChoices = page.locator(SELECTORS.modelOption);
  const total = await probeOrFallback(0, () => modelChoices.count());
  let clicked = false;
  for (let index = 0; index < total; index += 1) {
    const modelChoice = modelChoices.nth(index);
    const label = readFirstLine(await probeOrFallback("", () => readVisibleText(modelChoice)));

    const isLabelEmpty = label.length === 0;
    if (isLabelEmpty) continue;

    const normalizedMenuLabel = readLabelKey(label);

    const isMenuLabelFound = normalizedMenuLabel === needle || normalizedMenuLabel.includes(needle);
    if (isMenuLabelFound) {
      await modelChoice.click({ timeout: ARENA_CLICK_TIMEOUT_MILLISECONDS });
      clicked = true;
      break;
    }
  }

  const isNotClicked = !clicked;
  if (isNotClicked) {
    await probeOrFallback(null, () => page.keyboard.press("Escape"));
    throw new Error(`${displayName}: no model matching "${query}".`);
  }

  await probeOrFallback(null, () => page.waitForTimeout(ARENA_SETTLE_MILLISECONDS));
  await probeOrFallback(null, () => page.keyboard.press("Escape"));
  return detectCurrentModel(page);
};

const openModelPicker = async (page: Page): Promise<boolean> => {
  const trigger = readModelTrigger(page);

  const opened = await probeOrFallback(false, async () => {
    await trigger.click({ timeout: ARENA_CONTROL_CLICK_TIMEOUT_MILLISECONDS });
    return true;
  });

  const isNotOpened = !opened;
  if (isNotOpened) return false;

  await probeOrFallback(null, () => page.waitForTimeout(ARENA_QUICK_SETTLE_MILLISECONDS));
  const ready = await probeOrFallback(false, () =>
    page
      .locator(`${SELECTORS.modelSearch}, ${SELECTORS.modelOption}`)
      .first()
      .isVisible({ timeout: ARENA_CHECK_TIMEOUT_MILLISECONDS }),
  );
  return ready;
};

// Rewind is not supported on Arena.
const rewindLastUserPrompt = async (): Promise<void> => {
  throw new Error(`${displayName}: rewinding the last prompt is not supported.`);
};

// Arena exposes no stable stop control — always returns false.
const stopGenerating = async (
  _page: Page,
  _timeout = ARENA_CONTROL_CLICK_TIMEOUT_MILLISECONDS,
): Promise<boolean> => {
  return false;
};

const attachFilesToPrompt = async (page: Page, paths: string[]): Promise<void> => {
  await page.locator(SELECTORS.attach).first().setInputFiles(paths);
};

// Arena model labels are free-form ids (glm-5.1, Max, gpt-5.3-codex, …).
const isLikelyModelLabel = (label: string): boolean => {
  const trimmed = label.trim();
  const maxModelLabelLength = 60;

  const isTitleUnusable = trimmed.length === 0 || trimmed.length > maxModelLabelLength;
  if (isTitleUnusable) return false;

  const isArenaModeKnown = parseArenaMode(trimmed) != null;
  if (isArenaModeKnown) return true;

  return MODEL_NAME_RE.test(trimmed) || /[-._0-9]/.test(trimmed);
};

export const arenaProvider = {
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
} satisfies BrowserProvider;
