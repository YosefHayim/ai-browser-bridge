import type { Locator, Page } from "playwright";
import { PROVIDER_SETTINGS } from "@/config";
import type { ModelOption } from "@/domain/connector-types.ts";
import type { BrowserProvider, ReplyWaitSettings } from "@/providers/browser-provider.ts";
import { createGuestSessionError } from "@/providers/provider-errors.ts";
import { isReplyGenerating, waitForReplyIdle } from "@/providers/streaming-guard.ts";

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
  clip: PROVIDER_SETTINGS.flow.selectors.assistant,
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

const cleanVisibleCopy = (visibleCopy: string): string => {
  return visibleCopy
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

export const isLikelyModelLabel = (label: string): boolean => {
  return /\b(veo|imagen|nano\s*banana|fast|quality|standard|720p|1080p)\b/i.test(label);
};

// Pure completion policy — unit-tested without a browser.
export const isTurnSettled = (turn: {
  hasClip: boolean;
  generating: boolean;
  stableForMs: number;
}): boolean => {
  if (turn.generating) return false;

  const isStillSettling = turn.stableForMs < SETTLE_QUIET_MS;
  if (isStillSettling) return false;

  return turn.hasClip;
};

const captureLastClipRef = async (page: Page): Promise<string> => {
  return page.evaluate((selector: string) => {
    // Flow serves clips from a relative path (/fx/api/trpc/media...); resolve against
    // the page so agents receive an absolute, fetchable URL.
    const readAbsoluteUrl = (url: string): string => {
      if (!url) return "";

      try {
        return new URL(url, location.href).href;
      } catch {
        return url;
      }
    };
    const nodes = Array.from(document.querySelectorAll(selector));

    const last = nodes[nodes.length - 1];
    const isLastMissing = last == null;
    if (isLastMissing) return "";

    const isLastVideo = last instanceof HTMLVideoElement;
    const video = isLastVideo ? last : last.querySelector("video");
    const isVideoMissing = video === null || video === undefined;
    const fallbackElement = isVideoMissing ? null : video.querySelector("source");
    const videoFileUrl = isVideoMissing ? null : video.getAttribute("src");
    const isFallbackMissing = fallbackElement === null;
    const fallbackUrl = isFallbackMissing ? null : fallbackElement.getAttribute("src");
    let mediaUrl = "";

    if (videoFileUrl) mediaUrl = videoFileUrl;
    else if (fallbackUrl) mediaUrl = fallbackUrl;

    if (mediaUrl) return readAbsoluteUrl(mediaUrl);

    const link = last.querySelector<HTMLAnchorElement>('a[href$=".mp4"], a[download]');
    const isLinkMissing = link === null;
    const hrefAttr = isLinkMissing ? null : link.getAttribute("href");
    const isHrefAttrMissing = hrefAttr === null;
    const href = isHrefAttrMissing ? "" : hrefAttr;
    return readAbsoluteUrl(href);
  }, SELECTORS.clip);
};

const countClips = async (page: Page): Promise<number> => {
  return page.locator(SELECTORS.clip).count();
};

const captureAllMessages = async (
  page: Page,
): Promise<Array<{ role: string; content: string }>> => {
  return page.evaluate((selector: string) => {
    const readAbsoluteUrl = (url: string): string => {
      if (!url) return "";

      try {
        return new URL(url, location.href).href;
      } catch {
        return url;
      }
    };
    const messages: Array<{ role: string; content: string }> = [];
    const nodes = Array.from(document.querySelectorAll(selector));
    for (const node of nodes) {
      const isVideoNode = node instanceof HTMLVideoElement;
      const video = isVideoNode ? node : node.querySelector("video");
      const isVideoMissing = video === null || video === undefined;
      const fallbackElement = isVideoMissing ? null : video.querySelector("source");
      const videoFileUrl = isVideoMissing ? null : video.getAttribute("src");
      const isFallbackMissing = fallbackElement === null;
      const fallbackUrl = isFallbackMissing ? null : fallbackElement.getAttribute("src");
      let videoUrl = "";

      if (videoFileUrl) videoUrl = videoFileUrl;
      else if (fallbackUrl) videoUrl = fallbackUrl;

      const nodeLabel = node.textContent === null ? "" : node.textContent.trim();

      const ref = videoUrl ? readAbsoluteUrl(videoUrl) : nodeLabel;
      if (ref) messages.push({ role: "assistant", content: ref });
    }
    return messages;
  }, SELECTORS.clip);
};

type ParsedWaitSettings = {
  timeout: number;
  previousAssistantCount?: number;
};

const parseWaitSettings = (waitSettings: number | ReplyWaitSettings): ParsedWaitSettings => {
  const isWaitTypeNumber = typeof waitSettings === "number";
  if (isWaitTypeNumber) return { timeout: waitSettings };

  const timeout =
    waitSettings.timeout === undefined ? DEFAULT_GENERATION_TIMEOUT_MS : waitSettings.timeout;
  return {
    timeout,
    previousAssistantCount: waitSettings.previousAssistantCount,
  };
};

const isGenerating = async (page: Page): Promise<boolean> => {
  return page
    .locator(SELECTORS.generatingIndicator)
    .first()
    .isVisible()
    .catch(() => false);
};

const waitForGenerationStart = async (request: {
  page: Page;
  parsed: ParsedWaitSettings;
  startedAt: number;
}): Promise<void> => {
  const baseline =
    request.parsed.previousAssistantCount === undefined ? 0 : request.parsed.previousAssistantCount;
  while (Date.now() - request.startedAt < request.parsed.timeout) {
    const isStillRendering = await isGenerating(request.page);
    if (isStillRendering) return;

    const hasMoreClips = (await countClips(request.page)) > baseline;
    if (hasMoreClips) return;

    await request.page.waitForTimeout(500);
  }
  throw new Error("Timed out waiting for Flow to start generating a clip.");
};

const waitForGenerationEnd = async (request: {
  page: Page;
  parsed: ParsedWaitSettings;
  startedAt: number;
}): Promise<void> => {
  const baseline =
    request.parsed.previousAssistantCount === undefined ? 0 : request.parsed.previousAssistantCount;
  let lastRef = "";
  let stableSince = Date.now();
  while (Date.now() - request.startedAt < request.parsed.timeout) {
    const generating = await isGenerating(request.page);
    const count = await countClips(request.page);

    const ref = cleanVisibleCopy(await captureLastClipRef(request.page).catch(() => ""));
    const hasRefChanged = ref !== lastRef;
    if (hasRefChanged) {
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

    await request.page.waitForTimeout(1_000);
  }
  throw new Error("Timed out waiting for Flow clip to finish rendering.");
};

const waitForReply = async (
  page: Page,
  settings: number | ReplyWaitSettings = {},
): Promise<void> => {
  const parsed = parseWaitSettings(settings);
  const startedAt = Date.now();
  await waitForGenerationStart({ page, parsed, startedAt });
  await waitForGenerationEnd({ page, parsed, startedAt });
};

const isGuestSession = async (page: Page): Promise<boolean> => {
  const promptField = page.locator(SELECTORS.promptInput).filter({ visible: true }).first();
  const isPromptFieldVisible = await promptField.isVisible({ timeout: 2_500 }).catch(() => false);
  if (isPromptFieldVisible) return false;

  const signIn = page.locator(SELECTORS.signInButton).first();
  return signIn.isVisible({ timeout: 1_500 }).catch(() => true);
};

const assertSignedIn = async (page: Page): Promise<void> => {
  const isGuestSessionDetected = await isGuestSession(page);
  if (isGuestSessionDetected) {
    throw createGuestSessionError({
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
    const isHrefEmpty = !href;
    if (isHrefEmpty) continue;

    const title = cleanVisibleCopy(await link.innerText().catch(() => ""));
    const isAbsoluteHref = href.startsWith("http");
    const url = isAbsoluteHref ? href : `https://labs.google${href}`;
    const pathSegment = href.split("/").filter(Boolean).pop();
    const isPathSegmentMissing = pathSegment === undefined;
    const id = isPathSegmentMissing ? href : pathSegment;
    projects.push({ id, title: title || id, url });
  }
  return projects;
};

const navigateToConversation = async (page: Page, url: string): Promise<void> => {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(SELECTORS.promptInput, { timeout: 30_000 }).catch(() => {});
};

const startNewConversation = async (page: Page): Promise<void> => {
  await page.goto("https://labs.google/fx/tools/flow", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(SELECTORS.promptInput, { timeout: 30_000 }).catch(() => {});
};

const readFirstVisible = async (parameters: {
  page: Page;
  selector: string;
}): Promise<Locator | undefined> => {
  const locator = parameters.page.locator(parameters.selector);
  const count = await locator.count();
  for (let i = 0; i < count; i += 1) {
    const candidate = locator.nth(i);
    const isCandidateVisible = await candidate.isVisible().catch(() => false);
    if (isCandidateVisible) return candidate;
  }
  return undefined;
};

const detectCurrentModel = async (page: Page): Promise<string> => {
  try {
    const trigger = await readFirstVisible({ page, selector: SELECTORS.modelTrigger });
    const isTriggerMissing = trigger == null;
    if (isTriggerMissing) return "Veo 3.1";

    const triggerLabel = cleanVisibleCopy(await trigger.innerText().catch(() => ""));
    const line = triggerLabel.split("\n").find((part) => isLikelyModelLabel(part));

    const isLineMissing = line === undefined;
    if (isLineMissing) return "Veo 3.1";

    return line;
  } catch {
    return "Veo 3.1";
  }
};

const listAvailableModels = async (page: Page): Promise<ModelOption[]> => {
  const trigger = await readFirstVisible({ page, selector: SELECTORS.modelTrigger });
  const isTriggerMissing = trigger == null;
  if (isTriggerMissing) return [];

  await trigger.click().catch(() => {});
  await page.waitForSelector(SELECTORS.openMenu, { timeout: 3_000 }).catch(() => {});
  const menuElements = page.locator(
    `${SELECTORS.openMenu} [role="menuitem"], ${SELECTORS.openMenu} [role="option"]`,
  );
  const count = await menuElements.count();
  const models: ModelOption[] = [];
  for (let i = 0; i < count; i += 1) {
    const label = cleanVisibleCopy(
      await menuElements
        .nth(i)
        .innerText()
        .catch(() => ""),
    );
    const isLabelUnusable = !label || !isLikelyModelLabel(label);
    if (isLabelUnusable) continue;

    models.push({ id: label.toLowerCase().replace(/\s+/g, "-"), label, selected: false });
  }
  await page.keyboard.press("Escape").catch(() => {});
  return models;
};

const selectModel = async (page: Page, query: string): Promise<string> => {
  const models = await listAvailableModels(page);
  const normalized = query.trim().toLowerCase();

  const matchedModel = models.find(
    (model) =>
      model.label.toLowerCase().includes(normalized) ||
      model.id.includes(normalized.replace(/\s+/g, "-")),
  );
  if (!matchedModel) throw new Error(`Model not found in Flow picker: ${query}`);

  const trigger = await readFirstVisible({ page, selector: SELECTORS.modelTrigger });
  const isTriggerMissing = trigger == null;
  if (isTriggerMissing) throw new Error("Flow model picker is not available.");

  await trigger.click();
  await page.waitForSelector(SELECTORS.openMenu, { timeout: 3_000 });
  await page
    .locator(`${SELECTORS.openMenu} [role="menuitem"], ${SELECTORS.openMenu} [role="option"]`)
    .filter({ hasText: matchedModel.label })
    .first()
    .click();
  await page.keyboard.press("Escape").catch(() => {});
  return matchedModel.label;
};

const rewindLastUserPrompt = async (_page: Page, _replacement?: string): Promise<void> => {
  throw new Error("Rewind is not supported on Google Flow yet.");
};

const stopGenerating = async (page: Page, timeout = 5_000): Promise<boolean> => {
  const stop = page.locator(SELECTORS.cancelButton).first();
  const isStopHidden = !(await stop.isVisible({ timeout: 1_000 }).catch(() => false));
  if (isStopHidden) return false;

  await stop.click({ timeout });
  return true;
};

const attachFilesToPrompt = async (page: Page, paths: string[]): Promise<void> => {
  const isPathsEmpty = paths.length === 0;
  if (isPathsEmpty) return;

  const ingredients = paths.slice(0, MAX_INGREDIENTS);

  const ingredientField = page.locator(SELECTORS.ingredientInput).first();
  const hasIngredientField = (await ingredientField.count()) > 0;
  if (hasIngredientField) {
    await ingredientField.setInputFiles(ingredients);
    return;
  }

  const button = page.locator(SELECTORS.ingredientButton).first();
  const isButtonHidden = !(await button.isVisible({ timeout: 2_000 }).catch(() => false));
  if (isButtonHidden) {
    throw new Error("Flow ingredient upload controls are not available on this page.");
  }

  await button.click();
  const fileUpload = page.locator(SELECTORS.ingredientInput).first();
  await fileUpload.waitFor({ state: "attached", timeout: 5_000 });
  await fileUpload.setInputFiles(ingredients);
};

const readComposerDraft = async (page: Page): Promise<string> => {
  return page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(
      'textarea, [contenteditable="true"][role="textbox"]',
    );
    const isEditorMissing = editor == null;
    if (isEditorMissing) return "";

    const isMultilineEditor = editor instanceof HTMLTextAreaElement;
    if (isMultilineEditor) return editor.value.trim();

    return editor.innerText.trim();
  });
};

const clickGenerateOrEnter = async (page: Page): Promise<void> => {
  const generate = page.locator(SELECTORS.generateButton).filter({ visible: true }).first();
  try {
    await generate.waitFor({ state: "visible", timeout: 5_000 });
    await generate.click();
    return;
  } catch {
    // Generate button never surfaced; fall through to Enter unless a render is running.
  }

  // Enter during a render can interrupt or re-queue it — hold until idle.
  const isStillGenerating = await isReplyGenerating(page, SELECTORS.generatingIndicator);
  if (isStillGenerating) return;

  await page.keyboard.press("Enter");
};

const fillPromptAndSubmit = async (parameters: {
  page: Page;
  input: Locator;
  text: string;
}): Promise<void> => {
  await parameters.input.click();
  await parameters.input.fill(parameters.text);
  await parameters.input.dispatchEvent("input");
  await clickGenerateOrEnter(parameters.page);
};

const isComposerClears = async (parameters: { page: Page }): Promise<boolean> => {
  for (let poll = 0; poll < 10; poll += 1) {
    const isComposerEmpty = (await readComposerDraft(parameters.page)) === "";
    if (isComposerEmpty) return true;

    await parameters.page.waitForTimeout(500);
  }
  return false;
};

export const injectPrompt = async (page: Page, prompt: string): Promise<void> => {
  await page.bringToFront().catch(() => {});
  const promptField = page.locator(SELECTORS.promptInput).filter({ visible: true }).first();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // Let any in-flight render finish before typing so a retry never re-triggers generation.
    await waitForReplyIdle(page, SELECTORS.generatingIndicator);
    await fillPromptAndSubmit({ page, input: promptField, text: prompt });

    const hasComposerCleared = await isComposerClears({ page });
    if (hasComposerCleared) return;

    const isStillGeneratingAfterSend = await isReplyGenerating(page, SELECTORS.generatingIndicator);
    if (isStillGeneratingAfterSend) return;
  }
  throw new Error("injectPrompt: composer never cleared after 3 send attempts");
};

const captureLastReply = async (page: Page): Promise<string> => {
  return cleanVisibleCopy(await captureLastClipRef(page).catch(() => ""));
};

export const flowProvider = {
  id: "flow",
  origin: "labs.google",
  defaultUrl: "https://labs.google/fx/tools/flow",
  defaultModel: "Veo 3.1",
  displayName: "Flow",
  composerSelector: PROVIDER_SETTINGS.flow.selectors.composer,
  supportsMcpConnector: false,
  assertSignedIn,
  injectPrompt,
  waitForReply: waitForReply,
  captureLastReply: captureLastReply,
  countAssistantReplies: countClips,
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
