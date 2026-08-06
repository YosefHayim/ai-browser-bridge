import type { Locator, Page } from "playwright";
import { PROVIDER_CONFIG } from "@/config";
import type { ModelOption } from "@/features/domain";
import type { BrowserProvider, ResponseWaitOptions } from "../browserProvider.ts";
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
// editor with scripts/dev/captureProviderSelectors.mjs; recapture there if Google
// changes the UI (the generating/stop state is the one part still to verify live).

const MAX_INGREDIENTS = 3;
// Veo renders take minutes; keep a long default wait budget.
const DEFAULT_GENERATION_TIMEOUT_MS = 600_000;
// Finished clip reference must hold this quiet window before the turn settles.
const SETTLE_QUIET_MS = 2_000;

// LIVE-VERIFIED (2026-07-13): Slate composer, non-menu "Create" submit, image file
// input for ingredients, /tools/flow/project links. `generatingIndicator` /
// `cancelButton` still need a live render to verify and stay best-effort.
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

const normalizeDisplayText = (value: string): string => {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

export const isLikelyModelLabel = (value: string): boolean => {
  return /\b(veo|imagen|nano\s*banana|fast|quality|standard|720p|1080p)\b/i.test(value);
};

// Pure completion policy — unit-tested without a browser.
export const isTurnSettled = (state: {
  hasClip: boolean;
  generating: boolean;
  stableForMs: number;
}): boolean => {
  if (state.generating) return false;
  if (state.stableForMs < SETTLE_QUIET_MS) return false;
  return state.hasClip;
};

const captureLastClipRef = async (page: Page): Promise<string> => {
  return page.evaluate((selector: string) => {
    // Flow serves clips from a relative path (/fx/api/trpc/media...); resolve against
    // the page so agents receive an absolute, fetchable URL.
    const absoluteUrl = (raw: string): string => {
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
    const source = video === null || video === undefined ? null : video.querySelector("source");
    const videoSrc = video === null || video === undefined ? null : video.getAttribute("src");
    const sourceSrc = source === null ? null : source.getAttribute("src");
    let src = "";
    if (videoSrc) src = videoSrc;
    else if (sourceSrc) src = sourceSrc;
    if (src) return absoluteUrl(src);
    const link = last.querySelector<HTMLAnchorElement>('a[href$=".mp4"], a[download]');
    const hrefAttr = link === null ? null : link.getAttribute("href");
    const href = hrefAttr === null ? "" : hrefAttr;
    return absoluteUrl(href);
  }, SELECTORS.clip);
};

const countClips = async (page: Page): Promise<number> => {
  return page.locator(SELECTORS.clip).count();
};

const captureAllMessages = async (
  page: Page,
): Promise<Array<{ role: string; content: string }>> => {
  return page.evaluate((selector: string) => {
    const absoluteUrl = (raw: string): string => {
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
      const source = video === null || video === undefined ? null : video.querySelector("source");
      const videoSrc = video === null || video === undefined ? null : video.getAttribute("src");
      const sourceSrc = source === null ? null : source.getAttribute("src");
      let rawSrc = "";
      if (videoSrc) rawSrc = videoSrc;
      else if (sourceSrc) rawSrc = sourceSrc;
      const textContent = node.textContent === null ? "" : node.textContent.trim();
      const ref = rawSrc ? absoluteUrl(rawSrc) : textContent;
      if (ref) messages.push({ role: "assistant", content: ref });
    }
    return messages;
  }, SELECTORS.clip);
};

type ParsedWaitOptions = {
  timeout: number;
  previousAssistantCount?: number;
};

const parseWaitOptions = (waitOptions: number | ResponseWaitOptions): ParsedWaitOptions => {
  if (typeof waitOptions === "number") return { timeout: waitOptions };
  const timeout =
    waitOptions.timeout === undefined ? DEFAULT_GENERATION_TIMEOUT_MS : waitOptions.timeout;
  return {
    timeout,
    previousAssistantCount: waitOptions.previousAssistantCount,
  };
};

const isGenerating = async (page: Page): Promise<boolean> => {
  return page
    .locator(SELECTORS.generatingIndicator)
    .first()
    .isVisible()
    .catch(() => false);
};

const waitForGenerationStart = async (input: {
  page: Page;
  parsed: ParsedWaitOptions;
  startedAt: number;
}): Promise<void> => {
  const baseline =
    input.parsed.previousAssistantCount === undefined ? 0 : input.parsed.previousAssistantCount;
  while (Date.now() - input.startedAt < input.parsed.timeout) {
    if (await isGenerating(input.page)) return;
    if ((await countClips(input.page)) > baseline) return;
    await input.page.waitForTimeout(500);
  }
  throw new Error("Timed out waiting for Flow to start generating a clip.");
};

const waitForGenerationEnd = async (input: {
  page: Page;
  parsed: ParsedWaitOptions;
  startedAt: number;
}): Promise<void> => {
  const baseline =
    input.parsed.previousAssistantCount === undefined ? 0 : input.parsed.previousAssistantCount;
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

const waitForResponse = async (
  page: Page,
  options: number | ResponseWaitOptions = {},
): Promise<void> => {
  const parsed = parseWaitOptions(options);
  const startedAt = Date.now();
  await waitForGenerationStart({ page, parsed, startedAt });
  await waitForGenerationEnd({ page, parsed, startedAt });
};

const isGuestSession = async (page: Page): Promise<boolean> => {
  const input = page.locator(SELECTORS.promptInput).first();
  if (await input.isVisible({ timeout: 2_500 }).catch(() => false)) return false;
  const signIn = page.locator(SELECTORS.signInButton).first();
  return signIn.isVisible({ timeout: 1_500 }).catch(() => true);
};

const assertSignedIn = async (page: Page): Promise<void> => {
  if (await isGuestSession(page)) {
    throw new GuestSessionError({
      providerId: "flow",
      reason:
        "Run `bridge chrome start --provider flow`, complete Google sign-in, make sure the account has Flow access (Google AI Pro/Ultra), leave Chrome open, then run again.",
    });
  }
};

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
    const pathSegment = href.split("/").filter(Boolean).pop();
    const id = pathSegment === undefined ? href : pathSegment;
    projects.push({ id, title: title || id, url });
  }
  return projects;
};

const navigateToConversation = async (page: Page, url: string): Promise<void> => {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(SELECTORS.promptInput, { timeout: 30_000 }).catch(() => {});
};

const newConversation = async (page: Page): Promise<void> => {
  await page.goto("https://labs.google/fx/tools/flow", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(SELECTORS.promptInput, { timeout: 30_000 }).catch(() => {});
};

const firstVisible = async (params: {
  page: Page;
  selector: string;
}): Promise<Locator | undefined> => {
  const locator = params.page.locator(params.selector);
  const count = await locator.count();
  for (let i = 0; i < count; i += 1) {
    const candidate = locator.nth(i);
    if (await candidate.isVisible().catch(() => false)) return candidate;
  }
  return undefined;
};

const detectCurrentModel = async (page: Page): Promise<string> => {
  try {
    const trigger = await firstVisible({ page, selector: SELECTORS.modelTrigger });
    if (!trigger) return "Veo 3.1";
    const text = normalizeDisplayText(await trigger.innerText().catch(() => ""));
    const line = text.split("\n").find((part) => isLikelyModelLabel(part));
    if (line === undefined) return "Veo 3.1";
    return line;
  } catch {
    return "Veo 3.1";
  }
};

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

const rewindLastUserPrompt = async (_page: Page, _replacement?: string): Promise<void> => {
  throw new Error("Rewind is not supported on Google Flow yet.");
};

const stopGenerating = async (page: Page, timeout = 5_000): Promise<boolean> => {
  const stop = page.locator(SELECTORS.cancelButton).first();
  if (!(await stop.isVisible({ timeout: 1_000 }).catch(() => false))) return false;
  await stop.click({ timeout });
  return true;
};

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

const readComposerText = async (page: Page): Promise<string> => {
  return page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(
      'textarea, [contenteditable="true"][role="textbox"]',
    );
    if (!editor) return "";
    if (editor instanceof HTMLTextAreaElement) return editor.value.trim();
    return editor.innerText.trim();
  });
};

const clickGenerateOrEnter = async (page: Page): Promise<void> => {
  const generate = page.locator(SELECTORS.generateButton).first();
  try {
    await generate.waitFor({ state: "visible", timeout: 5_000 });
    await generate.click();
    return;
  } catch {
    // Generate button never surfaced; fall through to Enter unless a render is running.
  }
  // Enter during a render can interrupt or re-queue it — hold until idle.
  if (await isResponseGenerating(page, SELECTORS.generatingIndicator)) return;
  await page.keyboard.press("Enter");
};

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

const composerClears = async (params: { page: Page }): Promise<boolean> => {
  for (let poll = 0; poll < 10; poll += 1) {
    if ((await readComposerText(params.page)) === "") return true;
    await params.page.waitForTimeout(500);
  }
  return false;
};

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

const captureLastResponse = async (page: Page): Promise<string> => {
  return normalizeDisplayText(await captureLastClipRef(page).catch(() => ""));
};

export const flowProvider = {
  id: "flow",
  origin: "labs.google",
  defaultUrl: "https://labs.google/fx/tools/flow",
  defaultModel: "Veo 3.1",
  displayName: "Flow",
  composerSelector: PROVIDER_CONFIG.flow.selectors.composer,
  supportsMcpConnector: false,
  assertSignedIn,
  injectPrompt,
  waitForResponse,
  captureLastResponse,
  countAssistantResponses: countClips,
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
