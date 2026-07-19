import { DEFAULT_ASK_TIMEOUT_SECONDS, PROVIDER_CONFIG } from "@/config";
import type { ModelOption } from "@/features/domain";
import type { Page } from "playwright";
import type { BrowserProvider, ResponseWaitOptions } from "../browserProviderTypes.ts";
import { createStallReloadWatchdog } from "../renderStallWatchdog.ts";
import { waitForResponseIdle } from "../streamingGuard.ts";
import {
  ARENA_MODE_LABELS,
  ARENA_MODE_URLS,
  type ArenaMode,
  arenaModeFromUrl,
  parseArenaMode,
} from "./arenaModes.ts";

const PROFILE = PROVIDER_CONFIG.arena;

/** Stable DOM hooks for Arena (LIVE-VERIFIED 2026-07-19 against arena.ai). */
const SELECTORS = {
  composer:
    'textarea[name="message"], [contenteditable="true"][role="textbox"], [contenteditable="true"]',
  send: 'button[aria-label="Send message"]',
  // Battle / Direct assistant bodies live in option cards; user bubble is raised/self-end.
  assistant: "div.rounded-xl .prose",
  assistantFallback: ".prose",
  user: ".bg-surface-raised .prose, .self-end .prose",
  newChat: 'a[href="/code"], a[href$="/code"], a[href*="/direct"], a[href*="/agent"]',
  sidebarItem: 'a[href*="/c/"]',
  // Mode combobox shows Battle Mode / Direct / … (two copies exist; use visible).
  modeTrigger: 'button[role="combobox"]',
  modeOption: '[role="option"]',
  // Model trigger is a plain button labeled Max / glm-5.1 / … (not the mode combobox).
  modelSearch: 'input[placeholder="Search models"]',
  modelOption: '[role="option"]',
  modelTab:
    'button:has-text("Text"), button:has-text("Code"), button:has-text("Image"), button:has-text("Search")',
  attach: 'input[type="file"]',
  generatingText: "Generating",
} as const;

const MODEL_NAME_RE =
  /^(Max|gemini|glm|qwen|claude|gpt|kimi|minimax|deepseek|llama|mistral|sonar|o[13]|codex|flash|sonnet|opus|haiku)/i;

const firstLine = (text: string): string => (text.trim().split("\n")[0] ?? "").trim();

const normalize = (value: string): string => value.trim().toLowerCase();

/** True when body or Option cards still show Arena's "Generating…" status. */
const isGenerating = async (page: Page): Promise<boolean> => {
  const text = await page
    .locator("body")
    .innerText()
    .catch(() => "");
  if (/Generating/i.test(text)) return true;
  // Battle cards keep "Option A Generating..." in the header while streaming.
  const busyCards = await page
    .locator("div.rounded-xl")
    .filter({ hasText: /Generating/i })
    .count()
    .catch(() => 0);
  return busyCards > 0;
};

/** True when Battle/Side-by-Side vote controls are shown (turn finished). */
const hasVoteControls = async (page: Page): Promise<boolean> => {
  const votes = await page
    .locator('button[aria-label="A is better"], button[aria-label="B is better"]')
    .count()
    .catch(() => 0);
  return votes > 0;
};

/** Visible mode combobox (Arena mounts a hidden + visible duplicate). */
const visibleModeTrigger = (page: Page) => {
  return page
    .locator(SELECTORS.modeTrigger)
    .filter({ hasText: /Battle|Direct|Agent|Side/i })
    .last();
};

/**
 * Model trigger button: current model label (Max, glm-5.1, …), not the mode combobox.
 * On Side by Side there are two — prefer the first visible.
 */
const modelTrigger = (page: Page) => {
  return page
    .locator("button:visible")
    .filter({ hasText: MODEL_NAME_RE })
    .filter({ hasNotText: /Battle|Direct|Agent|Side by Side|New Chat|Add files|Hide/i })
    .first();
};

/**
 * Arena (arena.ai) browser adapter: modes (Battle / Agent / Side by Side / Direct),
 * model search picker, and dual Option A/B capture in battle/side-by-side.
 *
 * Default surface is **Direct** (`/code/direct`) — single-model chat is the best
 * fit for `bridge ask`. Pass `--model battle|agent|side|direct` to switch mode, or
 * `--model glm-5.1` (etc.) to pick a model in the current surface.
 */
export class ArenaPage implements BrowserProvider {
  readonly id = "arena";
  readonly origin = PROFILE.origin;
  readonly defaultUrl = ARENA_MODE_URLS.direct;
  readonly defaultModel = PROFILE.defaultModel;
  readonly displayName = PROFILE.displayName;
  readonly composerSelector = SELECTORS.composer;
  readonly supportsMcpConnector = false;

  /**
   * Fail when the composer is missing (page not ready or wrong mode shell).
   *
   * @param page - Page value.
   * @returns Completes when `assertSignedIn` finishes.
   * @example
   * ```ts
   * await arenaPage.assertSignedIn(page);
   * ```
   */
  async assertSignedIn(page: Page): Promise<void> {
    // Reused arena.ai tabs may sit on Agent or a dead conversation without a
    // composer — recover by opening the Direct home (best default for ask).
    let composer = await page
      .locator(this.composerSelector)
      .count()
      .catch(() => 0);
    if (composer === 0) {
      await page.goto(this.defaultUrl, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(this.composerSelector, { timeout: 15_000 }).catch(() => undefined);
      composer = await page
        .locator(this.composerSelector)
        .count()
        .catch(() => 0);
    }
    if (composer === 0) {
      throw new Error(
        `${this.displayName}: composer not found — open ${this.defaultUrl} (or switch mode) and try again.`,
      );
    }
  }

  /**
   * Type the prompt and submit via the Send control (or Enter).
   *
   * @param page - Page value.
   * @param text - Text value.
   * @returns Completes when `injectPrompt` finishes.
   * @example
   * ```ts
   * await arenaPage.injectPrompt(page, text);
   * ```
   */
  async injectPrompt(page: Page, text: string): Promise<void> {
    await waitForResponseIdle(page, "");
    // Drain a prior "Generating…" state when present (Arena has no stable Stop control).
    for (let i = 0; i < 30 && (await isGenerating(page)); i += 1) {
      await page.waitForTimeout(500).catch(() => undefined);
    }
    const composer = page.locator(this.composerSelector).first();
    await composer.click({ timeout: 8_000 });
    const tag = await composer.evaluate((el) => el.tagName.toLowerCase()).catch(() => "textarea");
    if (tag === "textarea") {
      await composer.fill(text);
    } else {
      await page.keyboard.press("Meta+A").catch(() => page.keyboard.press("Control+A"));
      await page.keyboard.type(text, { delay: 5 });
    }
    const sent = await page
      .locator(SELECTORS.send)
      .first()
      .click({ timeout: 4_000 })
      .then(() => true)
      .catch(() => false);
    if (!sent) await page.keyboard.press("Enter").catch(() => undefined);
  }

  /**
   * Wait until a new or changed assistant reply is stable and not generating.
   *
   * @param page - Page value.
   * @param options - Options that configure the method.
   * @returns Completes when `waitForResponse` finishes.
   * @example
   * ```ts
   * await arenaPage.waitForResponse(page, options);
   * ```
   */
  async waitForResponse(page: Page, options?: number | ResponseWaitOptions): Promise<void> {
    const opts = typeof options === "number" ? { timeout: options } : (options ?? {});
    const timeout = opts.timeout ?? DEFAULT_ASK_TIMEOUT_SECONDS * 1000;
    const previousText = opts.previousLastAssistantText ?? "";
    const deadline = Date.now() + timeout;
    // Wait until generation starts or text diverges from the previous turn.
    while (Date.now() < deadline) {
      if (await isGenerating(page)) break;
      const current = await this.captureLastResponse(page).catch(() => "");
      if (current && current !== previousText) break;
      await page.waitForTimeout(300).catch(() => undefined);
    }
    await this.waitForStreamIdle(page, Math.max(1_000, deadline - Date.now()), previousText);
  }

  private async waitForStreamIdle(
    page: Page,
    budgetMs: number,
    previousText: string,
  ): Promise<void> {
    const deadline = Date.now() + budgetMs;
    const watchdog = createStallReloadWatchdog({
      waitAfterReload: async (target) => {
        await target
          .waitForSelector(this.composerSelector, { timeout: 15_000 })
          .catch(() => undefined);
      },
      onReload: (count) =>
        process.stderr.write(
          `[bridge] ${this.displayName} render stalled — reloaded tab (reload ${count}).\n`,
        ),
    });
    let previous = "";
    while (Date.now() < deadline) {
      const generating = await isGenerating(page);
      const current = await this.captureLastResponse(page).catch(() => "");
      const voted = await hasVoteControls(page);
      const settled =
        current &&
        current === previous &&
        !generating &&
        current !== previousText &&
        !/Generating/i.test(current);
      // Vote controls mean both battle options finished even if text still streams chrome.
      if (settled || (voted && current && !generating)) return;
      if (current !== previous) {
        previous = current;
        if (current) watchdog.noteProgress();
      } else if (!generating && (await watchdog.maybeReload(page))) {
        previous = "";
        continue;
      }
      await page.waitForTimeout(400).catch(() => undefined);
    }
  }

  /**
   * Latest assistant reply. Battle / Side by Side return labeled Option A/B blocks.
   *
   * @param page - Page value.
   * @returns The `captureLastResponse` result.
   * @example
   * ```ts
   * const result = await arenaPage.captureLastResponse(page);
   * ```
   */
  async captureLastResponse(page: Page): Promise<string> {
    const mode = arenaModeFromUrl(page.url());
    if (mode === "battle" || mode === "side-by-side") {
      const dual = await this.captureDualOptions(page);
      if (dual) return dual;
    }
    const card = page.locator(SELECTORS.assistant);
    if ((await card.count().catch(() => 0)) > 0) {
      return (
        await card
          .last()
          .innerText()
          .catch(() => "")
      ).trim();
    }
    // Direct sometimes renders assistant prose without the battle card chrome.
    const prose = page.locator(SELECTORS.assistantFallback);
    const texts = await prose.allInnerTexts().catch(() => [] as string[]);
    const userTexts = await page
      .locator(SELECTORS.user)
      .allInnerTexts()
      .catch(() => [] as string[]);
    const users = new Set(userTexts.map((t) => t.trim()));
    const assistants = texts.map((t) => t.trim()).filter((t) => t && !users.has(t));
    return assistants[assistants.length - 1] ?? "";
  }

  /** Format Option A + Option B prose when both battle cards have content. */
  private async captureDualOptions(page: Page): Promise<string | null> {
    // Prefer cards that already have a prose body; fall back to any Option A/B shell.
    let cards = page.locator("div.rounded-xl").filter({ has: page.locator(".prose") });
    let count = await cards.count().catch(() => 0);
    if (count < 1) {
      cards = page.locator("div.rounded-xl").filter({ hasText: /Option\s*[AB]/i });
      count = await cards.count().catch(() => 0);
    }
    if (count < 1) return null;
    const parts: string[] = [];
    for (let i = 0; i < Math.min(count, 2); i += 1) {
      const card = cards.nth(i);
      const full = (await card.innerText().catch(() => "")).trim();
      if (!full || /Generating/i.test(full)) continue;
      const body = (
        await card
          .locator(".prose")
          .first()
          .innerText()
          .catch(() => "")
      ).trim();
      const content = body || full;
      // Strip vote chrome / "Deployed the project" noise when present as trailing UI.
      const cleaned = content
        .replace(/\bA is better\b[\s\S]*$/i, "")
        .replace(/\bB is better\b[\s\S]*$/i, "")
        .replace(/\bBoth are good\b[\s\S]*$/i, "")
        .trim();
      if (!cleaned) continue;
      const titleMatch = full.match(/Option\s*[AB]/i);
      const title = titleMatch?.[0] ?? `Option ${String.fromCharCode(65 + i)}`;
      parts.push(`${title}\n${cleaned}`);
    }
    if (parts.length === 0) return null;
    if (parts.length === 1) return parts[0] ?? null;
    return parts.join("\n\n");
  }

  /**
   * Count assistant reply nodes (card prose when present).
   *
   * @param page - Page value.
   * @returns The `countAssistantResponses` result.
   * @example
   * ```ts
   * const result = await arenaPage.countAssistantResponses(page);
   * ```
   */
  async countAssistantResponses(page: Page): Promise<number> {
    const n = await page
      .locator(SELECTORS.assistant)
      .count()
      .catch(() => 0);
    if (n > 0) return n;
    return page
      .locator(SELECTORS.assistantFallback)
      .count()
      .catch(() => 0);
  }

  /**
   * Capture user + assistant messages (best-effort).
   *
   * @param page - Page value.
   * @returns The `captureAllMessages` result.
   * @example
   * ```ts
   * const result = await arenaPage.captureAllMessages(page);
   * ```
   */
  async captureAllMessages(page: Page): Promise<Array<{ role: string; content: string }>> {
    const user = await page
      .locator(SELECTORS.user)
      .allInnerTexts()
      .catch(() => [] as string[]);
    const assistant = await page
      .locator(SELECTORS.assistant)
      .allInnerTexts()
      .catch(() => [] as string[]);
    const messages = [
      ...user.map((content) => ({ role: "user", content: content.trim() })),
      ...assistant.map((content) => ({ role: "assistant", content: content.trim() })),
    ];
    return messages.filter((m) => m.content);
  }

  /**
   * List sidebar conversation links.
   *
   * @param page - Page value.
   * @returns The `readSidebarConversations` result.
   * @example
   * ```ts
   * const result = await arenaPage.readSidebarConversations(page);
   * ```
   */
  async readSidebarConversations(
    page: Page,
  ): Promise<Array<{ id: string; title: string; url: string }>> {
    const links = page.locator(SELECTORS.sidebarItem);
    const total = Math.min(await links.count().catch(() => 0), 40);
    const conversations: Array<{ id: string; title: string; url: string }> = [];
    for (let index = 0; index < total; index += 1) {
      const link = links.nth(index);
      const href = await link.getAttribute("href").catch(() => null);
      if (!href) continue;
      const url = new URL(href, `https://${this.origin}`).toString();
      const title = firstLine(await link.innerText().catch(() => ""));
      const id = href.split("/").filter(Boolean).pop() ?? href;
      conversations.push({ id, title: title || id, url });
    }
    return conversations;
  }

  /**
   * Navigate to a conversation URL.
   *
   * @param page - Page value.
   * @param url - Url value.
   * @returns Completes when `navigateToConversation` finishes.
   * @example
   * ```ts
   * await arenaPage.navigateToConversation(page, url);
   * ```
   */
  async navigateToConversation(page: Page, url: string): Promise<void> {
    await page.goto(url, { waitUntil: "domcontentloaded" });
  }

  /**
   * Start a new chat on the current mode surface (falls back to Direct home).
   *
   * @param page - Page value.
   * @returns Completes when `newConversation` finishes.
   * @example
   * ```ts
   * await arenaPage.newConversation(page);
   * ```
   */
  async newConversation(page: Page): Promise<void> {
    const mode = arenaModeFromUrl(page.url());
    const home = ARENA_MODE_URLS[mode] ?? this.defaultUrl;
    const clicked = await page
      .locator(SELECTORS.newChat)
      .first()
      .click({ timeout: 3_000 })
      .then(() => true)
      .catch(() => false);
    if (!clicked) await page.goto(home, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(this.composerSelector, { timeout: 15_000 }).catch(() => undefined);
  }

  /**
   * Read the active model label from the model trigger button.
   *
   * @param page - Page value.
   * @returns The `detectCurrentModel` result.
   * @example
   * ```ts
   * const result = await arenaPage.detectCurrentModel(page);
   * ```
   */
  async detectCurrentModel(page: Page): Promise<string> {
    const raw = await modelTrigger(page)
      .innerText()
      .catch(() => "");
    const label = firstLine(raw);
    return label && this.isLikelyModelLabel(label) ? label : this.defaultModel;
  }

  /**
   * List models from the search picker (opens the dialog, samples options, closes).
   *
   * @param page - Page value.
   * @returns The `listAvailableModels` result.
   * @example
   * ```ts
   * const result = await arenaPage.listAvailableModels(page);
   * ```
   */
  async listAvailableModels(page: Page): Promise<ModelOption[]> {
    if (!(await this.openModelPicker(page))) return [];
    const options = page.locator(SELECTORS.modelOption);
    const total = Math.min(await options.count().catch(() => 0), 80);
    const models: ModelOption[] = [];
    const seen = new Set<string>();
    for (let index = 0; index < total; index += 1) {
      const option = options.nth(index);
      const label = firstLine(await option.innerText().catch(() => ""));
      if (!label || seen.has(label)) continue;
      // Skip mode-picker rows if the wrong menu is open.
      if (/^(Battle Mode|Agent Mode|Side by Side|Direct)\b/i.test(label)) continue;
      seen.add(label);
      const selected =
        (await option.getAttribute("data-selected").catch(() => null)) === "true" ||
        (await option.getAttribute("aria-selected").catch(() => null)) === "true";
      models.push({ id: label, label, selected });
    }
    await page.keyboard.press("Escape").catch(() => undefined);
    return models;
  }

  /**
   * Switch mode (`battle` / `agent` / `side` / `direct`) or pick a model by name.
   * Model queries open Search models and click the matching `[role=option]`.
   *
   * @param page - Page value.
   * @param query - Query text for the method.
   * @returns The `selectModel` result.
   * @example
   * ```ts
   * const result = await arenaPage.selectModel(page, query);
   * ```
   */
  async selectModel(page: Page, query: string): Promise<string> {
    const mode = parseArenaMode(query);
    if (mode) {
      await this.setMode(page, mode);
      return ARENA_MODE_LABELS[mode];
    }
    // Support "direct/glm-5.1" or "battle+..." — mode prefix then model.
    const slash = query.split(/[/+:]/);
    if (slash.length === 2) {
      const maybeMode = parseArenaMode(slash[0] ?? "");
      if (maybeMode) {
        await this.setMode(page, maybeMode);
        return this.selectModelByName(page, slash[1] ?? query);
      }
    }
    return this.selectModelByName(page, query);
  }

  /**
   * Navigate (or combobox-select) into an Arena mode surface.
   *
   * @param page - Page value.
   * @param mode - Mode value.
   * @returns Completes when `setMode` finishes.
   * @example
   * ```ts
   * await arenaPage.setMode(page, mode);
   * ```
   */
  async setMode(page: Page, mode: ArenaMode): Promise<void> {
    const target = ARENA_MODE_URLS[mode];
    if (arenaModeFromUrl(page.url()) === mode && page.url().includes(new URL(target).pathname)) {
      return;
    }
    // Prefer direct navigation — reliable and skips hidden combobox clones.
    await page.goto(target, { waitUntil: "domcontentloaded" });
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
    await page.waitForSelector(this.composerSelector, { timeout: 15_000 }).catch(() => undefined);
  }

  private async selectModelByName(page: Page, query: string): Promise<string> {
    if (!(await this.openModelPicker(page))) {
      throw new Error(`${this.displayName}: model picker is not available on this surface.`);
    }
    const search = page.locator(SELECTORS.modelSearch).first();
    if (await search.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await search.fill(query);
      await page.waitForTimeout(500).catch(() => undefined);
    }
    const needle = normalize(query);
    const options = page.locator(SELECTORS.modelOption);
    const total = await options.count().catch(() => 0);
    let clicked = false;
    for (let index = 0; index < total; index += 1) {
      const option = options.nth(index);
      const label = firstLine(await option.innerText().catch(() => ""));
      if (!label) continue;
      if (normalize(label) === needle || normalize(label).includes(needle)) {
        await option.click({ timeout: 4_000 });
        clicked = true;
        break;
      }
    }
    if (!clicked) {
      await page.keyboard.press("Escape").catch(() => undefined);
      throw new Error(`${this.displayName}: no model matching "${query}".`);
    }
    await page.waitForTimeout(600).catch(() => undefined);
    await page.keyboard.press("Escape").catch(() => undefined);
    return this.detectCurrentModel(page);
  }

  private async openModelPicker(page: Page): Promise<boolean> {
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
  }

  /**
   * Rewind is not supported on Arena.
   *
   * @returns Completes when `rewindLastUserPrompt` finishes.
   * @example
   * ```ts
   * await arenaPage.rewindLastUserPrompt();
   * ```
   */
  async rewindLastUserPrompt(): Promise<void> {
    throw new Error(`${this.displayName}: rewinding the last prompt is not supported.`);
  }

  /**
   * Arena exposes no stable stop control — always returns false.
   *
   * @param _page - Page value.
   * @param _timeout - Timeout value.
   * @returns The `stopGenerating` result.
   * @example
   * ```ts
   * const result = await arenaPage.stopGenerating(page, timeout);
   * ```
   */
  async stopGenerating(_page: Page, _timeout = 5_000): Promise<boolean> {
    return false;
  }

  /**
   * Attach files via the hidden file input.
   *
   * @param page - Page value.
   * @param paths - Paths value.
   * @returns Completes when `attachFilesToPrompt` finishes.
   * @example
   * ```ts
   * await arenaPage.attachFilesToPrompt(page, paths);
   * ```
   */
  async attachFilesToPrompt(page: Page, paths: string[]): Promise<void> {
    await page.locator(SELECTORS.attach).first().setInputFiles(paths);
  }

  /**
   * Arena model labels are free-form ids (glm-5.1, Max, gpt-5.3-codex, …).
   *
   * @param value - Value value.
   * @returns Whether the condition matches.
   * @example
   * ```ts
   * const result = arenaPage.isLikelyModelLabel(value);
   * ```
   */
  isLikelyModelLabel(value: string): boolean {
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 60) return false;
    if (parseArenaMode(trimmed)) return true;
    return MODEL_NAME_RE.test(trimmed) || /[-._0-9]/.test(trimmed);
  }
}
