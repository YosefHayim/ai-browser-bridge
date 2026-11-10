import type { Page } from "playwright";
import { DEFAULT_ASK_TIMEOUT_SECONDS, PROVIDER_CONFIG } from "@/config";
import type { ModelOption } from "@/domain/connector-types.ts";
import type { BrowserProvider, ReplyWaitSettings } from "@/providers/browser-provider.ts";
import { createStallReloadWatchdog } from "@/providers/render-stall-watchdog.ts";
import { waitForReplyIdle } from "@/providers/streaming-guard.ts";
import {
  ARENA_MODE_LABELS,
  ARENA_MODE_URLS,
  type ArenaMode,
  parseArenaMode,
  readArenaModeFromUrl,
} from "./arena-modes.ts";

const PROFILE = PROVIDER_CONFIG.arena;

// Stable DOM hooks for Arena (LIVE-VERIFIED 2026-07-19 against arena.ai).
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

// True when body or Option cards still show Arena's "Generating…" status.
const isGenerating = async (page: Page): Promise<boolean> => {
  const pageString = await page
    .locator("body")
    .innerText()
    .catch(() => "");
  const isGeneratingShown = /Generating/i.test(pageString);
  if (isGeneratingShown) return true;

  // Battle cards keep "Option A Generating..." in the header while streaming.
  const busyCardCount = await page
    .locator("div.rounded-xl")
    .filter({ hasText: /Generating/i })
    .count()
    .catch(() => 0);
  return busyCardCount > 0;
};

// Vote controls appear only after both battle options finish.
const hasVoteControls = async (page: Page): Promise<boolean> => {
  const voteCount = await page
    .locator('button[aria-label="A is better"], button[aria-label="B is better"]')
    .count()
    .catch(() => 0);
  return voteCount > 0;
};

// Arena mounts a hidden + visible mode combobox; prefer the visible one.
const readVisibleModeTrigger = (page: Page) => {
  return page
    .locator(SELECTORS.modeTrigger)
    .filter({ hasText: /Battle|Direct|Agent|Side/i })
    .last();
};

// Model trigger shows the current model label (Max, glm-5.1, …), not the mode combobox.
// On Side by Side there are two — prefer the first visible.
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
  // Reused arena.ai tabs may sit on Agent or a dead conversation without a
  // composer — recover by opening the Direct home (best default for ask).
  let composerCount = await page
    .locator(composerSelector)
    .count()
    .catch(() => 0);
  const isComposerMissing = composerCount === 0;
  if (isComposerMissing) {
    await page.goto(defaultUrl, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(composerSelector, { timeout: 15_000 }).catch(() => undefined);
    composerCount = await page
      .locator(composerSelector)
      .count()
      .catch(() => 0);
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
  for (let attempt = 0; attempt < 30 && (await isGenerating(page)); attempt += 1) {
    await page.waitForTimeout(500).catch(() => undefined);
  }
  const composer = page.locator(composerSelector).filter({ visible: true }).first();
  await composer.click({ timeout: 8_000 });
  const composerTag = await composer
    .evaluate((element) => element.tagName.toLowerCase())
    .catch(() => "textarea");

  const isComposerTagTextarea = composerTag === "textarea";
  if (isComposerTagTextarea) {
    await composer.fill(prompt);
  } else {
    await page.keyboard.press("Meta+A").catch(() => page.keyboard.press("Control+A"));
    await page.keyboard.type(prompt, { delay: 5 });
  }

  const sent = await page
    .locator(SELECTORS.send)
    .first()
    .click({ timeout: 4_000 })
    .then(() => true)
    .catch(() => false);
  const isNotSent = !sent;
  if (isNotSent) await page.keyboard.press("Enter").catch(() => undefined);
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

  let timeoutMs = DEFAULT_ASK_TIMEOUT_SECONDS * 1000;

  const hasChosenTimeout = chosenSettings.timeout !== undefined;
  if (hasChosenTimeout) timeoutMs = chosenSettings.timeout;

  let previousReply = "";

  if (chosenSettings.previousLastAssistantText !== undefined) {
    previousReply = chosenSettings.previousLastAssistantText;
  }

  const deadline = Date.now() + timeoutMs;
  // Wait until generation starts or text diverges from the previous turn.
  while (Date.now() < deadline) {
    const isPageGenerating = await isGenerating(page);
    if (isPageGenerating) break;

    const currentReply = await captureLastReply(page).catch(() => "");
    const hasNewReply = currentReply.length > 0 && currentReply !== previousReply;
    if (hasNewReply) break;

    await page.waitForTimeout(300).catch(() => undefined);
  }
  await waitForStreamIdle(page, Math.max(1_000, deadline - Date.now()), previousReply);
};

const waitForStreamIdle = async (
  page: Page,
  budgetMs: number,
  previousReply: string,
): Promise<void> => {
  const deadline = Date.now() + budgetMs;
  const watchdog = createStallReloadWatchdog({
    waitAfterReload: async (target) => {
      await target.waitForSelector(composerSelector, { timeout: 15_000 }).catch(() => undefined);
    },
    onReload: (reloadCount) =>
      process.stderr.write(
        `[bridge] ${displayName} render stalled — reloaded tab (reload ${reloadCount}).\n`,
      ),
  });
  let previousStableReply = "";
  while (Date.now() < deadline) {
    const generating = await isGenerating(page);
    const currentReply = await captureLastReply(page).catch(() => "");
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

    await page.waitForTimeout(400).catch(() => undefined);
  }
};

// Latest assistant reply. Battle / Side by Side return labeled Option A/B blocks.
const captureLastReply = async (page: Page): Promise<string> => {
  const mode = readArenaModeFromUrl(page.url());
  const isComparisonMode = mode === "battle" || mode === "side-by-side";
  if (isComparisonMode) {
    const dualSettingsString = await captureDualSettings(page);
    const hasDual = dualSettingsString !== undefined;
    if (hasDual) return dualSettingsString;
  }

  const assistantCards = page.locator(SELECTORS.assistant);
  const hasAssistantCards = (await assistantCards.count().catch(() => 0)) > 0;
  if (hasAssistantCards) {
    return (
      await assistantCards
        .last()
        .innerText()
        .catch(() => "")
    ).trim();
  }

  // Direct sometimes renders assistant prose without the battle card chrome.
  const proseBlocks = page.locator(SELECTORS.assistantFallback);
  const proseStrings = await proseBlocks.allInnerTexts().catch(() => [] as string[]);
  const userPrompts = await page
    .locator(SELECTORS.user)
    .allInnerTexts()
    .catch(() => [] as string[]);
  const userSet = new Set(userPrompts.map((userPrompt) => userPrompt.trim()));
  const assistantReplies = proseStrings
    .map((proseString) => proseString.trim())
    .filter((trimmedProse) => trimmedProse.length > 0 && !userSet.has(trimmedProse));
  const lastAssistant = assistantReplies[assistantReplies.length - 1];

  const isLastAssistantMissing = lastAssistant === undefined;
  if (isLastAssistantMissing) return "";

  return lastAssistant;
};

// Format Option A + Option B prose when both battle cards have content.
const captureDualSettings = async (page: Page): Promise<string | undefined> => {
  // Prefer cards that already have a prose body; fall back to any Option A/B shell.
  let cards = page.locator("div.rounded-xl").filter({ has: page.locator(".prose") });

  let cardCount = await cards.count().catch(() => 0);
  const isNoCardFound = cardCount < 1;
  if (isNoCardFound) {
    cards = page.locator("div.rounded-xl").filter({ hasText: /Option\s*[AB]/i });
    cardCount = await cards.count().catch(() => 0);
  }

  const hasNoCards = cardCount < 1;
  if (hasNoCards) return undefined;

  const labeledSettings: string[] = [];
  for (let index = 0; index < Math.min(cardCount, 2); index += 1) {
    const card = cards.nth(index);

    const cardString = (await card.innerText().catch(() => "")).trim();
    const isCardPending = cardString.length === 0 || /Generating/i.test(cardString);
    if (isCardPending) continue;

    const proseString = (
      await card
        .locator(".prose")
        .first()
        .innerText()
        .catch(() => "")
    ).trim();

    let optionString = proseString;
    const isOptionEmpty = optionString.length === 0;
    if (isOptionEmpty) optionString = cardString;

    // Strip vote chrome / "Deployed the project" noise when present as trailing UI.
    const cleanedOptionString = optionString
      .replace(/\bA is better\b[\s\S]*$/i, "")
      .replace(/\bB is better\b[\s\S]*$/i, "")
      .replace(/\bBoth are good\b[\s\S]*$/i, "")
      .trim();
    const isCleanedOptionEmpty = cleanedOptionString.length === 0;
    if (isCleanedOptionEmpty) continue;

    const titleHit = cardString.match(/(?<optionTitle>Option\s*[AB])/i);

    let optionTitle = `Option ${String.fromCharCode(65 + index)}`;
    if (titleHit?.groups?.optionTitle !== undefined) {
      optionTitle = titleHit.groups.optionTitle;
    }

    labeledSettings.push(`${optionTitle}\n${cleanedOptionString}`);
  }

  const isLabeledEmpty = labeledSettings.length === 0;
  if (isLabeledEmpty) return undefined;

  const isSingleLabeledOption = labeledSettings.length === 1;
  if (isSingleLabeledOption) {
    const onlyOption = labeledSettings[0];

    const isOnlyOptionMissing = onlyOption === undefined;
    if (isOnlyOptionMissing) return undefined;

    return onlyOption;
  }

  return labeledSettings.join("\n\n");
};

const countAssistantReplies = async (page: Page): Promise<number> => {
  const cardCount = await page
    .locator(SELECTORS.assistant)
    .count()
    .catch(() => 0);
  const hasCards = cardCount > 0;
  if (hasCards) return cardCount;

  return page
    .locator(SELECTORS.assistantFallback)
    .count()
    .catch(() => 0);
};

const captureAllMessages = async (
  page: Page,
): Promise<Array<{ role: string; content: string }>> => {
  const userPrompts = await page
    .locator(SELECTORS.user)
    .allInnerTexts()
    .catch(() => [] as string[]);
  const assistantReplies = await page
    .locator(SELECTORS.assistant)
    .allInnerTexts()
    .catch(() => [] as string[]);
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
  const total = Math.min(await links.count().catch(() => 0), 40);
  const conversations: Array<{ id: string; title: string; url: string }> = [];
  for (let index = 0; index < total; index += 1) {
    const link = links.nth(index);

    const href = await link.getAttribute("href").catch(() => null);
    const isHrefBlank = href === null || href.length === 0;
    if (isHrefBlank) continue;

    const conversationUrl = new URL(href, `https://${origin}`).toString();
    const linkTitle = readFirstLine(await link.innerText().catch(() => ""));
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
  const mode = readArenaModeFromUrl(page.url());
  const modeHomeUrl = ARENA_MODE_URLS[mode];

  const clicked = await page
    .locator(SELECTORS.newChat)
    .first()
    .click({ timeout: 3_000 })
    .then(() => true)
    .catch(() => false);
  const isNotClicked = !clicked;
  if (isNotClicked) await page.goto(modeHomeUrl, { waitUntil: "domcontentloaded" });

  await page.waitForSelector(composerSelector, { timeout: 15_000 }).catch(() => undefined);
};

const detectCurrentModel = async (page: Page): Promise<string> => {
  const triggerLabel = await readModelTrigger(page)
    .innerText()
    .catch(() => "");

  const modelLabel = readFirstLine(triggerLabel);
  const isModelLabelUsable = modelLabel.length > 0 && isLikelyModelLabel(modelLabel);
  if (isModelLabelUsable) return modelLabel;

  return defaultModel;
};

const listAvailableModels = async (page: Page): Promise<ModelOption[]> => {
  const isModelPickerNotOpened = !(await openModelPicker(page));
  if (isModelPickerNotOpened) return [];

  const modelChoices = page.locator(SELECTORS.modelOption);
  const total = Math.min(await modelChoices.count().catch(() => 0), 80);
  const models: ModelOption[] = [];
  const seenLabels = new Set<string>();
  for (let index = 0; index < total; index += 1) {
    const option = modelChoices.nth(index);

    const label = readFirstLine(await option.innerText().catch(() => ""));
    const isLabelSkipped = label.length === 0 || seenLabels.has(label);
    if (isLabelSkipped) continue;

    // Skip mode-picker rows if the wrong menu is open.
    const isArenaModeLabel = /^(Battle Mode|Agent Mode|Side by Side|Direct)\b/i.test(label);
    if (isArenaModeLabel) continue;

    seenLabels.add(label);
    const selectedAttribute = await option.getAttribute("data-selected").catch(() => null);
    const ariaSelected = await option.getAttribute("aria-selected").catch(() => null);
    const selected = selectedAttribute === "true" || ariaSelected === "true";
    models.push({ id: label, label, selected });
  }
  await page.keyboard.press("Escape").catch(() => undefined);
  return models;
};

// Switch mode (`battle` / `agent` / `side` / `direct`) or pick a model by name.
// Model queries open Search models and click the matching `[role=option]`.
const selectModel = async (page: Page, query: string): Promise<string> => {
  const mode = parseArenaMode(query);

  const hasMode = mode != null;
  if (hasMode) {
    await setMode(page, mode);
    return ARENA_MODE_LABELS[mode];
  }

  // Support "direct/glm-5.1" or "battle+..." — mode prefix then model.
  const modeModelTokens = query.split(/[/+:]/);
  const isPairedModelTokens = modeModelTokens.length === 2;
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
  const isOnTargetArenaPage =
    readArenaModeFromUrl(page.url()) === mode && page.url().includes(new URL(targetUrl).pathname);
  if (isOnTargetArenaPage) {
    return;
  }

  // Prefer direct navigation — reliable and skips hidden combobox clones.
  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800).catch(() => undefined);

  // If still wrong (redirect), try the mode combobox on a code surface.
  const isArenaModeWrong = readArenaModeFromUrl(page.url()) !== mode;
  if (isArenaModeWrong) {
    await page.goto(ARENA_MODE_URLS.battle, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(600).catch(() => undefined);
    const trigger = readVisibleModeTrigger(page);
    await trigger.click({ timeout: 5_000 });
    await page
      .locator(SELECTORS.modeOption)
      .filter({ hasText: new RegExp(`^${ARENA_MODE_LABELS[mode]}`, "i") })
      .first()
      .click({ timeout: 5_000 });
    await page.waitForTimeout(800).catch(() => undefined);
  }

  await page.waitForSelector(composerSelector, { timeout: 15_000 }).catch(() => undefined);
};

const selectModelByName = async (page: Page, query: string): Promise<string> => {
  const isModelPickerNotOpened = !(await openModelPicker(page));
  if (isModelPickerNotOpened) {
    throw new Error(`${displayName}: model picker is not available on this surface.`);
  }

  const search = page.locator(SELECTORS.modelSearch).first();
  const isSearchVisible = await search.isVisible({ timeout: 2_000 }).catch(() => false);
  if (isSearchVisible) {
    await search.fill(query);
    await page.waitForTimeout(500).catch(() => undefined);
  }

  const needle = readLabelKey(query);
  const modelChoices = page.locator(SELECTORS.modelOption);
  const total = await modelChoices.count().catch(() => 0);
  let clicked = false;
  for (let index = 0; index < total; index += 1) {
    const option = modelChoices.nth(index);
    const label = readFirstLine(await option.innerText().catch(() => ""));

    const isLabelEmpty = label.length === 0;
    if (isLabelEmpty) continue;

    const normalizedOptionLabel = readLabelKey(label);
    const isOptionFound =
      normalizedOptionLabel === needle || normalizedOptionLabel.includes(needle);
    if (isOptionFound) {
      await option.click({ timeout: 4_000 });
      clicked = true;
      break;
    }
  }

  const isNotClicked = !clicked;
  if (isNotClicked) {
    await page.keyboard.press("Escape").catch(() => undefined);
    throw new Error(`${displayName}: no model matching "${query}".`);
  }

  await page.waitForTimeout(600).catch(() => undefined);
  await page.keyboard.press("Escape").catch(() => undefined);
  return detectCurrentModel(page);
};

const openModelPicker = async (page: Page): Promise<boolean> => {
  const trigger = readModelTrigger(page);

  const opened = await trigger
    .click({ timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  const isNotOpened = !opened;
  if (isNotOpened) return false;

  await page.waitForTimeout(400).catch(() => undefined);
  // Confirm the search field or option list is up.
  const ready = await page
    .locator(`${SELECTORS.modelSearch}, ${SELECTORS.modelOption}`)
    .first()
    .isVisible({ timeout: 3_000 })
    .catch(() => false);
  return ready;
};

// Rewind is not supported on Arena.
const rewindLastUserPrompt = async (): Promise<void> => {
  throw new Error(`${displayName}: rewinding the last prompt is not supported.`);
};

// Arena exposes no stable stop control — always returns false.
const stopGenerating = async (_page: Page, _timeout = 5_000): Promise<boolean> => {
  return false;
};

const attachFilesToPrompt = async (page: Page, paths: string[]): Promise<void> => {
  await page.locator(SELECTORS.attach).first().setInputFiles(paths);
};

// Arena model labels are free-form ids (glm-5.1, Max, gpt-5.3-codex, …).
const isLikelyModelLabel = (label: string): boolean => {
  const trimmed = label.trim();
  const isTitleUnusable = trimmed.length === 0 || trimmed.length > 60;
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
