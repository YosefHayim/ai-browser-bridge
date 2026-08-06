import type { Page } from "playwright";
import { DEFAULT_ASK_TIMEOUT_SECONDS, PROVIDER_CONFIG } from "@/config";
import type { ModelOption } from "@/features/domain";
import type { BrowserProvider, ResponseWaitOptions } from "../browserProvider.ts";
import { stallReloadWatchdogFor } from "../renderStallWatchdog.ts";
import { waitForResponseIdle } from "../streamingGuard.ts";
import {
  ARENA_MODE_LABELS,
  ARENA_MODE_URLS,
  type ArenaMode,
  arenaModeFromUrl,
  parseArenaMode,
} from "./arenaModes.ts";

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

const firstLine = (text: string): string => {
  const line = text.trim().split("\n")[0];
  if (line === undefined) return "";
  return line.trim();
};

const normalizeLabel = (value: string): string => value.trim().toLowerCase();

// True when body or Option cards still show Arena's "Generating…" status.
const isGenerating = async (page: Page): Promise<boolean> => {
  const pageText = await page
    .locator("body")
    .innerText()
    .catch(() => "");
  if (/Generating/i.test(pageText)) return true;
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
const visibleModeTrigger = (page: Page) => {
  return page
    .locator(SELECTORS.modeTrigger)
    .filter({ hasText: /Battle|Direct|Agent|Side/i })
    .last();
};

// Model trigger shows the current model label (Max, glm-5.1, …), not the mode combobox.
// On Side by Side there are two — prefer the first visible.
const modelTrigger = (page: Page) => {
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
  if (composerCount === 0) {
    await page.goto(defaultUrl, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(composerSelector, { timeout: 15_000 }).catch(() => undefined);
    composerCount = await page
      .locator(composerSelector)
      .count()
      .catch(() => 0);
  }
  if (composerCount === 0) {
    throw new Error(
      `${displayName}: composer not found — open ${defaultUrl} (or switch mode) and try again.`,
    );
  }
};

const injectPrompt = async (page: Page, promptText: string): Promise<void> => {
  await waitForResponseIdle(page, "");
  // Drain a prior "Generating…" state when present (Arena has no stable Stop control).
  for (let attempt = 0; attempt < 30 && (await isGenerating(page)); attempt += 1) {
    await page.waitForTimeout(500).catch(() => undefined);
  }
  const composer = page.locator(composerSelector).first();
  await composer.click({ timeout: 8_000 });
  const composerTag = await composer
    .evaluate((element) => element.tagName.toLowerCase())
    .catch(() => "textarea");
  if (composerTag === "textarea") {
    await composer.fill(promptText);
  } else {
    await page.keyboard.press("Meta+A").catch(() => page.keyboard.press("Control+A"));
    await page.keyboard.type(promptText, { delay: 5 });
  }
  const sent = await page
    .locator(SELECTORS.send)
    .first()
    .click({ timeout: 4_000 })
    .then(() => true)
    .catch(() => false);
  if (!sent) await page.keyboard.press("Enter").catch(() => undefined);
};

const waitForResponse = async (
  page: Page,
  waitOptions?: number | ResponseWaitOptions,
): Promise<void> => {
  let resolved: ResponseWaitOptions = {};
  if (typeof waitOptions === "number") {
    resolved = { timeout: waitOptions };
  } else if (waitOptions !== undefined) {
    resolved = waitOptions;
  }
  let timeoutMs = DEFAULT_ASK_TIMEOUT_SECONDS * 1000;
  if (resolved.timeout !== undefined) timeoutMs = resolved.timeout;
  let previousText = "";
  if (resolved.previousLastAssistantText !== undefined) {
    previousText = resolved.previousLastAssistantText;
  }
  const deadline = Date.now() + timeoutMs;
  // Wait until generation starts or text diverges from the previous turn.
  while (Date.now() < deadline) {
    if (await isGenerating(page)) break;
    const currentText = await captureLastResponse(page).catch(() => "");
    if (currentText.length > 0 && currentText !== previousText) break;
    await page.waitForTimeout(300).catch(() => undefined);
  }
  await waitForStreamIdle(page, Math.max(1_000, deadline - Date.now()), previousText);
};

const waitForStreamIdle = async (
  page: Page,
  budgetMs: number,
  previousText: string,
): Promise<void> => {
  const deadline = Date.now() + budgetMs;
  const watchdog = stallReloadWatchdogFor({
    waitAfterReload: async (target) => {
      await target.waitForSelector(composerSelector, { timeout: 15_000 }).catch(() => undefined);
    },
    onReload: (reloadCount) =>
      process.stderr.write(
        `[bridge] ${displayName} render stalled — reloaded tab (reload ${reloadCount}).\n`,
      ),
  });
  let previousStableText = "";
  while (Date.now() < deadline) {
    const generating = await isGenerating(page);
    const currentText = await captureLastResponse(page).catch(() => "");
    const voted = await hasVoteControls(page);
    const settled =
      currentText.length > 0 &&
      currentText === previousStableText &&
      !generating &&
      currentText !== previousText &&
      !/Generating/i.test(currentText);
    // Vote controls mean both battle options finished even if text still streams chrome.
    if (settled || (voted && currentText.length > 0 && !generating)) return;
    if (currentText !== previousStableText) {
      previousStableText = currentText;
      if (currentText.length > 0) watchdog.noteProgress();
    } else if (!generating && (await watchdog.maybeReload(page))) {
      previousStableText = "";
      continue;
    }
    await page.waitForTimeout(400).catch(() => undefined);
  }
};

// Latest assistant reply. Battle / Side by Side return labeled Option A/B blocks.
const captureLastResponse = async (page: Page): Promise<string> => {
  const mode = arenaModeFromUrl(page.url());
  if (mode === "battle" || mode === "side-by-side") {
    const dualOptionsText = await captureDualOptions(page);
    if (dualOptionsText !== undefined) return dualOptionsText;
  }
  const assistantCards = page.locator(SELECTORS.assistant);
  if ((await assistantCards.count().catch(() => 0)) > 0) {
    return (
      await assistantCards
        .last()
        .innerText()
        .catch(() => "")
    ).trim();
  }
  // Direct sometimes renders assistant prose without the battle card chrome.
  const proseBlocks = page.locator(SELECTORS.assistantFallback);
  const proseTexts = await proseBlocks.allInnerTexts().catch(() => [] as string[]);
  const userTexts = await page
    .locator(SELECTORS.user)
    .allInnerTexts()
    .catch(() => [] as string[]);
  const userSet = new Set(userTexts.map((userText) => userText.trim()));
  const assistantTexts = proseTexts
    .map((proseText) => proseText.trim())
    .filter((proseText) => proseText.length > 0 && !userSet.has(proseText));
  const lastAssistant = assistantTexts[assistantTexts.length - 1];
  if (lastAssistant === undefined) return "";
  return lastAssistant;
};

// Format Option A + Option B prose when both battle cards have content.
const captureDualOptions = async (page: Page): Promise<string | undefined> => {
  // Prefer cards that already have a prose body; fall back to any Option A/B shell.
  let cards = page.locator("div.rounded-xl").filter({ has: page.locator(".prose") });
  let cardCount = await cards.count().catch(() => 0);
  if (cardCount < 1) {
    cards = page.locator("div.rounded-xl").filter({ hasText: /Option\s*[AB]/i });
    cardCount = await cards.count().catch(() => 0);
  }
  if (cardCount < 1) return undefined;
  const labeledOptions: string[] = [];
  for (let index = 0; index < Math.min(cardCount, 2); index += 1) {
    const card = cards.nth(index);
    const cardText = (await card.innerText().catch(() => "")).trim();
    if (cardText.length === 0 || /Generating/i.test(cardText)) continue;
    const proseText = (
      await card
        .locator(".prose")
        .first()
        .innerText()
        .catch(() => "")
    ).trim();
    let optionText = proseText;
    if (optionText.length === 0) optionText = cardText;
    // Strip vote chrome / "Deployed the project" noise when present as trailing UI.
    const cleanedOptionText = optionText
      .replace(/\bA is better\b[\s\S]*$/i, "")
      .replace(/\bB is better\b[\s\S]*$/i, "")
      .replace(/\bBoth are good\b[\s\S]*$/i, "")
      .trim();
    if (cleanedOptionText.length === 0) continue;
    const titleMatch = cardText.match(/(?<optionTitle>Option\s*[AB])/i);
    let optionTitle = `Option ${String.fromCharCode(65 + index)}`;
    if (titleMatch?.groups?.optionTitle !== undefined) {
      optionTitle = titleMatch.groups.optionTitle;
    }
    labeledOptions.push(`${optionTitle}\n${cleanedOptionText}`);
  }
  if (labeledOptions.length === 0) return undefined;
  if (labeledOptions.length === 1) {
    const onlyOption = labeledOptions[0];
    if (onlyOption === undefined) return undefined;
    return onlyOption;
  }
  return labeledOptions.join("\n\n");
};

const countAssistantResponses = async (page: Page): Promise<number> => {
  const cardCount = await page
    .locator(SELECTORS.assistant)
    .count()
    .catch(() => 0);
  if (cardCount > 0) return cardCount;
  return page
    .locator(SELECTORS.assistantFallback)
    .count()
    .catch(() => 0);
};

const captureAllMessages = async (
  page: Page,
): Promise<Array<{ role: string; content: string }>> => {
  const userTexts = await page
    .locator(SELECTORS.user)
    .allInnerTexts()
    .catch(() => [] as string[]);
  const assistantTexts = await page
    .locator(SELECTORS.assistant)
    .allInnerTexts()
    .catch(() => [] as string[]);
  const messages = [
    ...userTexts.map((userText) => ({ role: "user", content: userText.trim() })),
    ...assistantTexts.map((assistantText) => ({
      role: "assistant",
      content: assistantText.trim(),
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
    if (href === null || href.length === 0) continue;
    const conversationUrl = new URL(href, `https://${origin}`).toString();
    const linkTitle = firstLine(await link.innerText().catch(() => ""));
    const pathSegment = href.split("/").filter(Boolean).pop();
    let conversationId = href;
    if (pathSegment !== undefined) conversationId = pathSegment;
    let conversationTitle = linkTitle;
    if (conversationTitle.length === 0) conversationTitle = conversationId;
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

const newConversation = async (page: Page): Promise<void> => {
  const mode = arenaModeFromUrl(page.url());
  const modeHomeUrl = ARENA_MODE_URLS[mode];
  const clicked = await page
    .locator(SELECTORS.newChat)
    .first()
    .click({ timeout: 3_000 })
    .then(() => true)
    .catch(() => false);
  if (!clicked) await page.goto(modeHomeUrl, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(composerSelector, { timeout: 15_000 }).catch(() => undefined);
};

const detectCurrentModel = async (page: Page): Promise<string> => {
  const triggerText = await modelTrigger(page)
    .innerText()
    .catch(() => "");
  const modelLabel = firstLine(triggerText);
  if (modelLabel.length > 0 && isLikelyModelLabel(modelLabel)) return modelLabel;
  return defaultModel;
};

const listAvailableModels = async (page: Page): Promise<ModelOption[]> => {
  if (!(await openModelPicker(page))) return [];
  const options = page.locator(SELECTORS.modelOption);
  const total = Math.min(await options.count().catch(() => 0), 80);
  const models: ModelOption[] = [];
  const seenLabels = new Set<string>();
  for (let index = 0; index < total; index += 1) {
    const option = options.nth(index);
    const label = firstLine(await option.innerText().catch(() => ""));
    if (label.length === 0 || seenLabels.has(label)) continue;
    // Skip mode-picker rows if the wrong menu is open.
    if (/^(Battle Mode|Agent Mode|Side by Side|Direct)\b/i.test(label)) continue;
    seenLabels.add(label);
    const dataSelected = await option.getAttribute("data-selected").catch(() => null);
    const ariaSelected = await option.getAttribute("aria-selected").catch(() => null);
    const selected = dataSelected === "true" || ariaSelected === "true";
    models.push({ id: label, label, selected });
  }
  await page.keyboard.press("Escape").catch(() => undefined);
  return models;
};

// Switch mode (`battle` / `agent` / `side` / `direct`) or pick a model by name.
// Model queries open Search models and click the matching `[role=option]`.
const selectModel = async (page: Page, query: string): Promise<string> => {
  const mode = parseArenaMode(query);
  if (mode !== undefined) {
    await setMode(page, mode);
    return ARENA_MODE_LABELS[mode];
  }
  // Support "direct/glm-5.1" or "battle+..." — mode prefix then model.
  const modeModelTokens = query.split(/[/+:]/);
  if (modeModelTokens.length === 2) {
    const modeToken = modeModelTokens[0];
    const modelToken = modeModelTokens[1];
    if (modeToken !== undefined && modelToken !== undefined) {
      const maybeMode = parseArenaMode(modeToken);
      if (maybeMode !== undefined) {
        await setMode(page, maybeMode);
        return selectModelByName(page, modelToken);
      }
    }
  }
  return selectModelByName(page, query);
};

const setMode = async (page: Page, mode: ArenaMode): Promise<void> => {
  const targetUrl = ARENA_MODE_URLS[mode];
  if (arenaModeFromUrl(page.url()) === mode && page.url().includes(new URL(targetUrl).pathname)) {
    return;
  }
  // Prefer direct navigation — reliable and skips hidden combobox clones.
  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800).catch(() => undefined);
  // If still wrong (redirect), try the mode combobox on a code surface.
  if (arenaModeFromUrl(page.url()) !== mode) {
    await page.goto(ARENA_MODE_URLS.battle, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(600).catch(() => undefined);
    const trigger = visibleModeTrigger(page);
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
  if (!(await openModelPicker(page))) {
    throw new Error(`${displayName}: model picker is not available on this surface.`);
  }
  const search = page.locator(SELECTORS.modelSearch).first();
  if (await search.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await search.fill(query);
    await page.waitForTimeout(500).catch(() => undefined);
  }
  const needle = normalizeLabel(query);
  const options = page.locator(SELECTORS.modelOption);
  const total = await options.count().catch(() => 0);
  let clicked = false;
  for (let index = 0; index < total; index += 1) {
    const option = options.nth(index);
    const label = firstLine(await option.innerText().catch(() => ""));
    if (label.length === 0) continue;
    const normalizedOptionLabel = normalizeLabel(label);
    if (normalizedOptionLabel === needle || normalizedOptionLabel.includes(needle)) {
      await option.click({ timeout: 4_000 });
      clicked = true;
      break;
    }
  }
  if (!clicked) {
    await page.keyboard.press("Escape").catch(() => undefined);
    throw new Error(`${displayName}: no model matching "${query}".`);
  }
  await page.waitForTimeout(600).catch(() => undefined);
  await page.keyboard.press("Escape").catch(() => undefined);
  return detectCurrentModel(page);
};

const openModelPicker = async (page: Page): Promise<boolean> => {
  const trigger = modelTrigger(page);
  const opened = await trigger
    .click({ timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (!opened) return false;
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
const isLikelyModelLabel = (value: string): boolean => {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 60) return false;
  if (parseArenaMode(trimmed) !== undefined) return true;
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
} satisfies BrowserProvider;
