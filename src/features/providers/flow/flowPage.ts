import { PROVIDER_CONFIG } from "@/config";
import type { ModelOption } from "@/features/domain";
import type { Locator, Page } from "playwright";
import type { BrowserProvider, ResponseWaitOptions } from "../browserProviderTypes.ts";
import { GuestSessionError } from "../providerErrors.ts";
import { isResponseGenerating, waitForResponseIdle } from "../streamingGuard.ts";

// Google Labs Flow is a Veo video studio, not a text chat. This adapter maps the
// chat-shaped BrowserProvider contract onto Flow: `injectPrompt` types a shot prompt
// and triggers generation, `attachFilesToPrompt` uploads ingredients (reference
// images), `waitForResponse` polls until the clip finishes rendering, and
// `captureLastResponse` returns a reference (video src / download href) to the newest
// clip — the mp4 itself is pulled through the existing download path. Flow has no MCP
// connector UI, so the MCP server and tunnel are skipped upstream (supportsMcpConnector
// is false). Selectors were LIVE-VERIFIED (2026-07-13) against a signed-in Flow project
// editor with src/scripts/dev/captureProviderSelectors.mjs; recapture there if Google
// changes the UI (the generating/stop state is the one part still to verify live).

/** Maximum reference images ("ingredients") Flow accepts per prompt. */
const MAX_INGREDIENTS = 3;

/** Clip generation is slow (Veo renders take minutes); allow a long default wait. */
const DEFAULT_GENERATION_TIMEOUT_MS = 600_000;

/** Quiet window a finished clip reference must hold before the turn counts as settled. */
const SETTLE_QUIET_MS = 2_000;

// --- selectors.config.ts ---
// LIVE-VERIFIED (2026-07-13) against a signed-in Flow project editor. The composer is a
// Slate editor, the submit is the "Create" button that is not a menu (no aria-haspopup),
// ingredients upload through an image file input, and projects are /tools/flow/project
// links. `generatingIndicator` / `cancelButton` are the pieces still LIVE-VERIFY — they
// need a running render to observe — so they stay best-effort.
/** DOM selectors for Google Flow. */
export const SELECTORS = {
  promptInput: ['[data-slate-editor="true"]', '[role="textbox"][contenteditable="true"]'].join(
    ", ",
  ),
  generateButton: 'button:has-text("Create"):not([aria-haspopup])',
  clip: PROVIDER_CONFIG.flow.selectors.assistant,
  generatingIndicator: [
    '[aria-busy="true"]',
    '[class*="progress" i]',
    '[class*="loading" i]',
    'button[aria-label*="Cancel" i]',
  ].join(", "),
  cancelButton: ['button[aria-label*="Cancel" i]', 'button[aria-label*="Stop" i]'].join(", "),
  ingredientInput: 'input[type="file"][accept*="image" i], input[type="file"]',
  ingredientButton: [
    'button:has-text("Add Media")',
    'button[aria-label*="ingredient" i]',
    'button[aria-label*="Upload" i]',
  ].join(", "),
  signInButton: [
    'a[href*="accounts.google.com"]',
    'button:has-text("Sign in")',
    '[aria-label*="Sign in" i]',
  ].join(", "),
  projectLink: 'a[href*="/tools/flow/project"]',
  modelTrigger: ['button:has-text("Settings")', 'button:has-text("Veo")'].join(", "),
  openMenu: '[role="menu"], [role="listbox"]',
} as const;

// --- text.helpers.ts ---

/** Normalize whitespace in display text scraped from the DOM. */
const normalizeDisplayText = (value: string): string => {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

// --- model.helpers.ts ---

/**
 * True when a string looks like a real Flow/Veo model or quality label.
 *
 * @param value - Candidate label text.
 * @returns Whether the value resembles a Flow model label.
 * @example
 * ```ts
 * const result = isLikelyModelLabel("Veo 3.1 - Quality");
 * ```
 */
export const isLikelyModelLabel = (value: string): boolean => {
  return /\b(veo|imagen|nano\s*banana|fast|quality|standard|720p|1080p)\b/i.test(value);
};

// --- settle.ts ---

/**
 * Decide whether the current generation turn has produced a finished clip.
 * Pure helper so completion policy is unit-testable without a browser.
 *
 * @param state - Generation snapshot (clip presence, generating flag, stability).
 * @returns Whether the clip turn has settled.
 * @example
 * ```ts
 * const result = isTurnSettled({ hasClip: true, generating: false, stableForMs: 2_500 });
 * ```
 */
export const isTurnSettled = (state: {
  hasClip: boolean;
  generating: boolean;
  stableForMs: number;
}): boolean => {
  if (state.generating) return false;
  if (state.stableForMs < SETTLE_QUIET_MS) return false;
  return state.hasClip;
};

// --- capture-clip.ts ---

/** Extract a reference (video src or download href) to the newest rendered clip. */
const captureLastClipRef = async (page: Page): Promise<string> => {
  return page.evaluate((selector: string) => {
    // Flow serves clips from a relative path (/fx/api/trpc/media...); resolve it against
    // the page so an agent receives an absolute, fetchable URL.
    const toAbsolute = (raw: string): string => {
      if (!raw) return "";
      try {
        return new URL(raw, location.href).href;
      } catch {
        return raw;
      }
    };
    const nodes = Array.from(document.querySelectorAll(selector));
    const last = nodes[nodes.length - 1];
    if (!last) return "";
    const video = last instanceof HTMLVideoElement ? last : last.querySelector("video");
    const source = video?.querySelector("source") ?? null;
    const src = video?.getAttribute("src") ?? source?.getAttribute("src") ?? "";
    if (src) return toAbsolute(src);
    const link = last.querySelector<HTMLAnchorElement>('a[href$=".mp4"], a[download]');
    return toAbsolute(link?.getAttribute("href") ?? "");
  }, SELECTORS.clip);
};

/** Count clips currently rendered in the asset grid. */
const countClips = async (page: Page): Promise<number> => {
  return page.locator(SELECTORS.clip).count();
};

/** Extract every rendered clip reference in DOM order as assistant messages. */
const captureAllMessages = async (
  page: Page,
): Promise<Array<{ role: string; content: string }>> => {
  return page.evaluate((selector: string) => {
    const toAbsolute = (raw: string): string => {
      if (!raw) return "";
      try {
        return new URL(raw, location.href).href;
      } catch {
        return raw;
      }
    };
    const messages: Array<{ role: string; content: string }> = [];
    const nodes = Array.from(document.querySelectorAll(selector));
    for (const node of nodes) {
      const video = node instanceof HTMLVideoElement ? node : node.querySelector("video");
      const source = video?.querySelector("source") ?? null;
      const rawSrc = video?.getAttribute("src") ?? source?.getAttribute("src") ?? "";
      const ref = rawSrc ? toAbsolute(rawSrc) : (node.textContent ?? "").trim();
      if (ref) messages.push({ role: "assistant", content: ref });
    }
    return messages;
  }, SELECTORS.clip);
};

// --- wait-response.ts ---

/** Parsed timeout and baseline fields for Flow generation waits. */
interface ParsedWaitOptions {
  timeout: number;
  previousAssistantCount?: number;
}

/** Coerce the flexible wait argument into a concrete timeout + baseline. */
const parseWaitOptions = (options: number | ResponseWaitOptions): ParsedWaitOptions => {
  if (typeof options === "number") return { timeout: options };
  return {
    timeout: options.timeout ?? DEFAULT_GENERATION_TIMEOUT_MS,
    previousAssistantCount: options.previousAssistantCount,
  };
};

/** True while Flow is actively rendering a clip. */
const isGenerating = async (page: Page): Promise<boolean> => {
  return page
    .locator(SELECTORS.generatingIndicator)
    .first()
    .isVisible()
    .catch(() => false);
};

/** Wait until Flow either starts generating or a new clip appears past the baseline. */
const waitForGenerationStart = async (input: {
  page: Page;
  parsed: ParsedWaitOptions;
  startedAt: number;
}): Promise<void> => {
  const baseline = input.parsed.previousAssistantCount ?? 0;
  while (Date.now() - input.startedAt < input.parsed.timeout) {
    if (await isGenerating(input.page)) return;
    if ((await countClips(input.page)) > baseline) return;
    await input.page.waitForTimeout(500);
  }
  throw new Error("Timed out waiting for Flow to start generating a clip.");
};

/** Wait until generation stops and the newest clip reference holds steady. */
const waitForGenerationEnd = async (input: {
  page: Page;
  parsed: ParsedWaitOptions;
  startedAt: number;
}): Promise<void> => {
  const baseline = input.parsed.previousAssistantCount ?? 0;
  let lastRef = "";
  let stableSince = Date.now();
  while (Date.now() - input.startedAt < input.parsed.timeout) {
    const generating = await isGenerating(input.page);
    const count = await countClips(input.page);
    const ref = normalizeDisplayText(await captureLastClipRef(input.page).catch(() => ""));
    if (ref !== lastRef) {
      lastRef = ref;
      stableSince = Date.now();
    }
    if (
      isTurnSettled({
        hasClip: count > baseline && !!ref,
        generating,
        stableForMs: Date.now() - stableSince,
      })
    )
      return;
    await input.page.waitForTimeout(1_000);
  }
  throw new Error("Timed out waiting for Flow clip to finish rendering.");
};

/** Wait for a Flow generation to start and then finish rendering. */
const waitForResponse = async (
  page: Page,
  options: number | ResponseWaitOptions = {},
): Promise<void> => {
  const parsed = parseWaitOptions(options);
  const startedAt = Date.now();
  await waitForGenerationStart({ page, parsed, startedAt });
  await waitForGenerationEnd({ page, parsed, startedAt });
};

// --- navigation.ts ---

/** True when Flow is showing the unauthenticated shell. */
const isGuestSession = async (page: Page): Promise<boolean> => {
  const input = page.locator(SELECTORS.promptInput).first();
  if (await input.isVisible({ timeout: 2_500 }).catch(() => false)) return false;
  const signIn = page.locator(SELECTORS.signInButton).first();
  return signIn.isVisible({ timeout: 1_500 }).catch(() => true);
};

/** Fail fast before sending a prompt to an unauthenticated Flow session. */
const assertSignedIn = async (page: Page): Promise<void> => {
  if (await isGuestSession(page)) {
    throw new GuestSessionError({
      providerId: "flow",
      reason:
        "Run `bridge chrome start --provider flow`, complete Google sign-in, make sure the account has Flow access (Google AI Pro/Ultra), leave Chrome open, then run again.",
    });
  }
};

/** Read Flow's project list from the sidebar when available. */
const readSidebarConversations = async (
  page: Page,
): Promise<Array<{ id: string; title: string; url: string }>> => {
  const links = await page.locator(SELECTORS.projectLink).all();
  const projects: Array<{ id: string; title: string; url: string }> = [];
  for (const link of links) {
    const href = await link.getAttribute("href");
    if (!href) continue;
    const title = normalizeDisplayText(await link.innerText().catch(() => ""));
    const url = href.startsWith("http") ? href : `https://labs.google${href}`;
    const id = href.split("/").filter(Boolean).pop() ?? href;
    projects.push({ id, title: title || id, url });
  }
  return projects;
};

/** Navigate to a specific Flow project by URL. */
const navigateToConversation = async (page: Page, url: string): Promise<void> => {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(SELECTORS.promptInput, { timeout: 30_000 }).catch(() => {});
};

/** Start a new Flow project. */
const newConversation = async (page: Page): Promise<void> => {
  await page.goto("https://labs.google/fx/tools/flow", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(SELECTORS.promptInput, { timeout: 30_000 }).catch(() => {});
};

// --- model.ts ---

/** Return the first visible locator matching a selector, or null. */
const firstVisible = async (params: { page: Page; selector: string }): Promise<Locator | null> => {
  const locator = params.page.locator(params.selector);
  const count = await locator.count();
  for (let i = 0; i < count; i += 1) {
    const candidate = locator.nth(i);
    if (await candidate.isVisible().catch(() => false)) return candidate;
  }
  return null;
};

/** Detect the currently selected Veo model/quality from the page. */
const detectCurrentModel = async (page: Page): Promise<string> => {
  try {
    const trigger = await firstVisible({ page, selector: SELECTORS.modelTrigger });
    if (!trigger) return "Veo 3.1";
    const text = normalizeDisplayText(await trigger.innerText().catch(() => ""));
    const line = text.split("\n").find((part) => isLikelyModelLabel(part));
    return line ?? "Veo 3.1";
  } catch {
    return "Veo 3.1";
  }
};

/** List Veo model/quality options exposed by Flow's picker when it can be opened. */
const listAvailableModels = async (page: Page): Promise<ModelOption[]> => {
  const trigger = await firstVisible({ page, selector: SELECTORS.modelTrigger });
  if (!trigger) return [];
  await trigger.click().catch(() => {});
  await page.waitForSelector(SELECTORS.openMenu, { timeout: 3_000 }).catch(() => {});
  const items = page.locator(
    `${SELECTORS.openMenu} [role="menuitem"], ${SELECTORS.openMenu} [role="option"]`,
  );
  const count = await items.count();
  const models: ModelOption[] = [];
  for (let i = 0; i < count; i += 1) {
    const label = normalizeDisplayText(
      await items
        .nth(i)
        .innerText()
        .catch(() => ""),
    );
    if (!label || !isLikelyModelLabel(label)) continue;
    models.push({ id: label.toLowerCase().replace(/\s+/g, "-"), label, selected: false });
  }
  await page.keyboard.press("Escape").catch(() => {});
  return models;
};

/** Switch Flow to a Veo model/quality exposed by the picker. */
const selectModel = async (page: Page, query: string): Promise<string> => {
  const models = await listAvailableModels(page);
  const normalized = query.trim().toLowerCase();
  const match = models.find(
    (model) =>
      model.label.toLowerCase().includes(normalized) ||
      model.id.includes(normalized.replace(/\s+/g, "-")),
  );
  if (!match) throw new Error(`Model not found in Flow picker: ${query}`);
  const trigger = await firstVisible({ page, selector: SELECTORS.modelTrigger });
  if (!trigger) throw new Error("Flow model picker is not available.");
  await trigger.click();
  await page.waitForSelector(SELECTORS.openMenu, { timeout: 3_000 });
  await page
    .locator(`${SELECTORS.openMenu} [role="menuitem"], ${SELECTORS.openMenu} [role="option"]`)
    .filter({ hasText: match.label })
    .first()
    .click();
  await page.keyboard.press("Escape").catch(() => {});
  return match.label;
};

// --- actions.ts ---

/** Flow has no prompt-rewind affordance; fail clearly. */
const rewindLastUserPrompt = async (_page: Page, _replacement?: string): Promise<void> => {
  throw new Error("Rewind is not supported on Google Flow yet.");
};

/** Cancel an in-progress Flow generation when a cancel control is present. */
const stopGenerating = async (page: Page, timeout = 5_000): Promise<boolean> => {
  const stop = page.locator(SELECTORS.cancelButton).first();
  if (!(await stop.isVisible({ timeout: 1_000 }).catch(() => false))) return false;
  await stop.click({ timeout });
  return true;
};

/** Upload up to three reference images as Flow ingredients. */
const attachFilesToPrompt = async (page: Page, paths: string[]): Promise<void> => {
  if (paths.length === 0) return;
  const ingredients = paths.slice(0, MAX_INGREDIENTS);
  const directInput = page.locator(SELECTORS.ingredientInput).first();
  if ((await directInput.count()) > 0) {
    await directInput.setInputFiles(ingredients);
    return;
  }
  const button = page.locator(SELECTORS.ingredientButton).first();
  if (!(await button.isVisible({ timeout: 2_000 }).catch(() => false))) {
    throw new Error("Flow ingredient upload controls are not available on this page.");
  }
  await button.click();
  const fileInput = page.locator(SELECTORS.ingredientInput).first();
  await fileInput.waitFor({ state: "attached", timeout: 5_000 });
  await fileInput.setInputFiles(ingredients);
};

// --- inject-prompt.ts ---

/** Read the current composer text, tolerating textarea and contenteditable shapes. */
const readComposerText = async (page: Page): Promise<string> => {
  return page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(
      'textarea, [contenteditable="true"][role="textbox"]',
    );
    if (!editor) return "";
    const value = editor instanceof HTMLTextAreaElement ? editor.value : editor.innerText;
    return (value ?? "").trim();
  });
};

/** Fill the composer once and submit via the generate button or Enter. */
const clickGenerateOrEnter = async (page: Page): Promise<void> => {
  const generate = page.locator(SELECTORS.generateButton).first();
  try {
    await generate.waitFor({ state: "visible", timeout: 5_000 });
    await generate.click();
    return;
  } catch {
    // Generate button never surfaced; fall through to the Enter fallback unless a render runs.
  }
  // Pressing Enter while a clip renders would interrupt or re-queue it — hold until idle.
  if (await isResponseGenerating(page, SELECTORS.generatingIndicator)) return;
  await page.keyboard.press("Enter");
};

/** Type a prompt and submit it once. */
const fillAndSubmit = async (params: {
  page: Page;
  input: Locator;
  text: string;
}): Promise<void> => {
  await params.input.click();
  await params.input.fill(params.text);
  await params.input.dispatchEvent("input");
  await clickGenerateOrEnter(params.page);
};

/** Poll until the composer drains, confirming the prompt was submitted. */
const composerClears = async (params: { page: Page }): Promise<boolean> => {
  for (let poll = 0; poll < 10; poll += 1) {
    if ((await readComposerText(params.page)) === "") return true;
    await params.page.waitForTimeout(500);
  }
  return false;
};

/**
 * Type a shot prompt into Flow's composer and submit generation.
 *
 * @param page - Playwright page to operate on.
 * @param text - Shot/scene prompt text.
 * @returns Completes when the prompt is submitted (composer cleared).
 * @example
 * ```ts
 * await injectPrompt(page, "a cat surfing a neon wave, cinematic");
 * ```
 */
export const injectPrompt = async (page: Page, text: string): Promise<void> => {
  await page.bringToFront().catch(() => {});
  const input = page.locator(SELECTORS.promptInput).first();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // Let any in-flight render finish before typing so a retry never re-triggers generation.
    await waitForResponseIdle(page, SELECTORS.generatingIndicator);
    await fillAndSubmit({ page, input, text });
    if (await composerClears({ page })) return;
    if (await isResponseGenerating(page, SELECTORS.generatingIndicator)) return;
  }
  throw new Error("injectPrompt: composer never cleared after 3 send attempts");
};

/** Read a reference to the newest rendered clip (video src / download href). */
const captureLastResponse = async (page: Page): Promise<string> => {
  return normalizeDisplayText(await captureLastClipRef(page).catch(() => ""));
};

export class FlowPage implements BrowserProvider {
  readonly id = "flow" as const;
  readonly origin = "labs.google";
  readonly defaultUrl = "https://labs.google/fx/tools/flow";
  readonly defaultModel = "Veo 3.1";
  readonly displayName = "Flow";
  readonly composerSelector = PROVIDER_CONFIG.flow.selectors.composer;
  readonly supportsMcpConnector = false;

  /**
   * Fail fast when Flow is not signed in.
   *
   * @param page - Page value.
   * @returns Completes when `assertSignedIn` finishes.
   * @example
   * ```ts
   * await flowPage.assertSignedIn(page);
   * ```
   */
  async assertSignedIn(page: Page): Promise<void> {
    return assertSignedIn(page);
  }
  /**
   * Type a shot prompt into the composer and trigger generation.
   *
   * @param page - Page value.
   * @param text - Text value.
   * @returns Completes when `injectPrompt` finishes.
   * @example
   * ```ts
   * await flowPage.injectPrompt(page, text);
   * ```
   */
  async injectPrompt(page: Page, text: string): Promise<void> {
    return injectPrompt(page, text);
  }
  /**
   * Wait until the clip finishes rendering.
   *
   * @param page - Page value.
   * @param options - Options that configure the method.
   * @returns Completes when `waitForResponse` finishes.
   * @example
   * ```ts
   * await flowPage.waitForResponse(page, options);
   * ```
   */
  async waitForResponse(page: Page, options?: number | ResponseWaitOptions): Promise<void> {
    return waitForResponse(page, options);
  }
  /**
   * Read a reference to the newest rendered clip.
   *
   * @param page - Page value.
   * @returns The `captureLastResponse` result.
   * @example
   * ```ts
   * const result = await flowPage.captureLastResponse(page);
   * ```
   */
  async captureLastResponse(page: Page): Promise<string> {
    return captureLastResponse(page);
  }
  /**
   * Count rendered clip tiles.
   *
   * @param page - Page value.
   * @returns The `countAssistantResponses` result.
   * @example
   * ```ts
   * const result = await flowPage.countAssistantResponses(page);
   * ```
   */
  async countAssistantResponses(page: Page): Promise<number> {
    return countClips(page);
  }
  /**
   * Capture all rendered clips as assistant messages.
   *
   * @param page - Page value.
   * @returns The `captureAllMessages` result.
   * @example
   * ```ts
   * const result = await flowPage.captureAllMessages(page);
   * ```
   */
  async captureAllMessages(page: Page): Promise<Array<{ role: string; content: string }>> {
    return captureAllMessages(page);
  }
  /**
   * Read Flow project entries from the sidebar.
   *
   * @param page - Page value.
   * @returns The `readSidebarConversations` result.
   * @example
   * ```ts
   * const result = await flowPage.readSidebarConversations(page);
   * ```
   */
  async readSidebarConversations(
    page: Page,
  ): Promise<Array<{ id: string; title: string; url: string }>> {
    return readSidebarConversations(page);
  }
  /**
   * Navigate to a Flow project URL.
   *
   * @param page - Page value.
   * @param url - Url value.
   * @returns Completes when `navigateToConversation` finishes.
   * @example
   * ```ts
   * await flowPage.navigateToConversation(page, url);
   * ```
   */
  async navigateToConversation(page: Page, url: string): Promise<void> {
    return navigateToConversation(page, url);
  }
  /**
   * Open a new Flow project.
   *
   * @param page - Page value.
   * @returns Completes when `newConversation` finishes.
   * @example
   * ```ts
   * await flowPage.newConversation(page);
   * ```
   */
  async newConversation(page: Page): Promise<void> {
    return newConversation(page);
  }
  /**
   * Detect the currently selected Veo model/quality label.
   *
   * @param page - Page value.
   * @returns The `detectCurrentModel` result.
   * @example
   * ```ts
   * const result = await flowPage.detectCurrentModel(page);
   * ```
   */
  async detectCurrentModel(page: Page): Promise<string> {
    return detectCurrentModel(page);
  }
  /**
   * List Veo model/quality options exposed in the picker.
   *
   * @param page - Page value.
   * @returns The `listAvailableModels` result.
   * @example
   * ```ts
   * const result = await flowPage.listAvailableModels(page);
   * ```
   */
  async listAvailableModels(page: Page): Promise<ModelOption[]> {
    return listAvailableModels(page);
  }
  /**
   * Switch to a Veo model/quality matching the query string.
   *
   * @param page - Page value.
   * @param query - Query text for the method.
   * @returns The `selectModel` result.
   * @example
   * ```ts
   * const result = await flowPage.selectModel(page, query);
   * ```
   */
  async selectModel(page: Page, query: string): Promise<string> {
    return selectModel(page, query);
  }
  /**
   * Rewind is not supported on Google Flow yet.
   *
   * @param page - Page value.
   * @param replacement - Replacement value.
   * @returns Completes when `rewindLastUserPrompt` finishes.
   * @example
   * ```ts
   * await flowPage.rewindLastUserPrompt(page, replacement);
   * ```
   */
  async rewindLastUserPrompt(page: Page, replacement?: string): Promise<void> {
    return rewindLastUserPrompt(page, replacement);
  }
  /**
   * Cancel an in-progress generation when possible.
   *
   * @param page - Page value.
   * @param timeout - Timeout value.
   * @returns The `stopGenerating` result.
   * @example
   * ```ts
   * const result = await flowPage.stopGenerating(page, timeout);
   * ```
   */
  async stopGenerating(page: Page, timeout?: number): Promise<boolean> {
    return stopGenerating(page, timeout);
  }
  /**
   * Upload reference images as Flow ingredients (max three).
   *
   * @param page - Page value.
   * @param paths - Paths value.
   * @returns Completes when `attachFilesToPrompt` finishes.
   * @example
   * ```ts
   * await flowPage.attachFilesToPrompt(page, paths);
   * ```
   */
  async attachFilesToPrompt(page: Page, paths: string[]): Promise<void> {
    return attachFilesToPrompt(page, paths);
  }
  /**
   * True when a string looks like a Flow/Veo model label.
   *
   * @param value - Value value.
   * @returns Whether the condition matches.
   * @example
   * ```ts
   * const result = flowPage.isLikelyModelLabel(value);
   * ```
   */
  isLikelyModelLabel(value: string): boolean {
    return isLikelyModelLabel(value);
  }
}
