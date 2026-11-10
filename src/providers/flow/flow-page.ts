import type { Locator, Page } from "playwright";
import { PROVIDER_SETTINGS } from "@/config";
import type { ModelOption } from "@/domain/connector-types.ts";
import type { BrowserProvider, ReplyWaitSettings } from "@/providers/browser-provider.ts";
import { probeOrFallback, readVisibleCopy } from "@/providers/browser-provider.ts";
import { createGuestSessionError } from "@/providers/provider-errors.ts";
import { isReplyGenerating, waitForReplyIdle } from "@/providers/streaming-guard.ts";

const ESCAPE_KEY = "Escape";

const HYPHEN = "-";

const VEO_MODEL_LABEL = "Veo 3.1";

const FLOW_TOOL_URL = "https://labs.google/fx/tools/flow";

const HTML_PARSED_WAIT = "domcontentloaded";

const FLOW_PROVIDER_ID = "flow";

const HREF_ATTRIBUTE = "href";

const SRC_ATTRIBUTE = "src";

const MEDIA_FILE_TAG = "source";

const VIDEO_TAG = "video";

const SPACE_SEPARATOR = " ";

const CANCEL_BUTTON_SELECTOR = 'button[aria-label*="Cancel" i]';

const LIST_SEPARATOR = ", ";

const CONTROL_WAIT_TIMEOUT_MILLISECONDS = 5_000;

const MENU_WAIT_TIMEOUT_MILLISECONDS = 3_000;

const PROMPT_FIELD_WAIT_TIMEOUT_MILLISECONDS = 30_000;

const UI_SETTLE_MILLISECONDS = 500;

// Maps Flow's Veo studio onto the chat-shaped BrowserProvider contract.

const MAX_INGREDIENTS = 3;
// Veo renders take minutes; keep a long default wait budget.
const DEFAULT_GENERATION_TIMEOUT_MILLISECONDS = 600_000;
// Finished clip reference must hold this quiet window before the turn settles.
const SETTLE_QUIET_MILLISECONDS = 2_000;

// Generating and stop indicators stay best-effort until a live render verifies them.
export const SELECTORS = {
  promptInput: ['[data-slate-editor="true"]', '[role="textbox"][contenteditable="true"]'].join(
    LIST_SEPARATOR,
  ),
  generateButton: 'button:has-text("Create"):not([aria-haspopup])',
  clip: PROVIDER_SETTINGS.flow.selectors.assistant,
  generatingIndicator: [
    '[aria-busy="true"]',
    '[class*="progress" i]',
    '[class*="loading" i]',
    CANCEL_BUTTON_SELECTOR,
  ].join(LIST_SEPARATOR),
  cancelButton: [CANCEL_BUTTON_SELECTOR, 'button[aria-label*="Stop" i]'].join(LIST_SEPARATOR),
  ingredientInput: 'input[type="file"][accept*="image" i], input[type="file"]',
  ingredientButton: [
    'button:has-text("Add Media")',
    'button[aria-label*="ingredient" i]',
    'button[aria-label*="Upload" i]',
  ].join(LIST_SEPARATOR),
  signInButton: [
    'a[href*="accounts.google.com"]',
    'button:has-text("Sign in")',
    '[aria-label*="Sign in" i]',
  ].join(LIST_SEPARATOR),
  projectLink: 'a[href*="/tools/flow/project"]',
  modelTrigger: ['button:has-text("Settings")', 'button:has-text("Veo")'].join(LIST_SEPARATOR),
  openMenu: '[role="menu"], [role="listbox"]',
} as const;

const cleanVisibleCopy = (visibleCopy: string): string => {
  return visibleCopy
    .replace(/\u00a0/g, SPACE_SEPARATOR)
    .replace(/\s+/g, SPACE_SEPARATOR)
    .trim();
};

export const isLikelyModelLabel = (label: string): boolean => {
  return /\b(veo|imagen|nano\s*banana|fast|quality|standard|720p|1080p)\b/i.test(label);
};

export const isTurnSettled = (turn: {
  hasClip: boolean;
  generating: boolean;
  stableForMilliseconds: number;
}): boolean => {
  const isTurnGenerating = turn.generating;
  if (isTurnGenerating) return false;

  const isStillSettling = turn.stableForMilliseconds < SETTLE_QUIET_MILLISECONDS;
  if (isStillSettling) return false;

  return turn.hasClip;
};

const captureLastClipRef = async (page: Page): Promise<string> => {
  return page.evaluate((selector: string) => {
    // Flow serves clip paths relative to the page, so they are made absolute for agents.
    const readAbsoluteUrl = (url: string): string => {
      const isUrlMissing = !url;
      if (isUrlMissing) return "";

      try {
        return new URL(url, location.href).href;
      } catch (error) {
        const isUrlInvalid = error instanceof TypeError;
        if (isUrlInvalid) return url;

        throw error;
      }
    };
    const matchingElements = document.querySelectorAll(selector);
    const nodes = Array.from(matchingElements);

    const last = nodes[nodes.length - 1];

    const isLastMissing = last == null;
    if (isLastMissing) return "";

    const isLastVideo = last instanceof HTMLVideoElement;
    const video = isLastVideo ? last : last.querySelector(VIDEO_TAG);
    const isVideoMissing = video === null || video == null;
    const fallbackElement = isVideoMissing ? null : video.querySelector(MEDIA_FILE_TAG);
    const videoFileUrl = isVideoMissing ? null : video.getAttribute(SRC_ATTRIBUTE);
    const isFallbackMissing = fallbackElement === null;
    const fallbackUrl = isFallbackMissing ? null : fallbackElement.getAttribute(SRC_ATTRIBUTE);
    let mediaUrl = "";

    const isVideoFileUrlFound = videoFileUrl != null && videoFileUrl !== "";
    const isFallbackUrlFound = fallbackUrl != null && fallbackUrl !== "";
    if (isVideoFileUrlFound) mediaUrl = videoFileUrl;
    else if (isFallbackUrlFound) mediaUrl = fallbackUrl;

    const isMediaUrlFound = mediaUrl !== "";
    if (isMediaUrlFound) return readAbsoluteUrl(mediaUrl);

    const link = last.querySelector<HTMLAnchorElement>('a[href$=".mp4"], a[download]');
    const isLinkMissing = link === null;
    const hrefAttr = isLinkMissing ? null : link.getAttribute(HREF_ATTRIBUTE);
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
      const isUrlMissing = !url;
      if (isUrlMissing) return "";

      try {
        return new URL(url, location.href).href;
      } catch (error) {
        const isUrlInvalid = error instanceof TypeError;
        if (isUrlInvalid) return url;

        throw error;
      }
    };
    const messages: Array<{ role: string; content: string }> = [];
    const matchingElements = document.querySelectorAll(selector);
    const nodes = Array.from(matchingElements);
    for (const node of nodes) {
      const isVideoNode = node instanceof HTMLVideoElement;
      const video = isVideoNode ? node : node.querySelector(VIDEO_TAG);
      const isVideoMissing = video === null || video == null;
      const fallbackElement = isVideoMissing ? null : video.querySelector(MEDIA_FILE_TAG);
      const videoFileUrl = isVideoMissing ? null : video.getAttribute(SRC_ATTRIBUTE);
      const isFallbackMissing = fallbackElement === null;
      const fallbackUrl = isFallbackMissing ? null : fallbackElement.getAttribute(SRC_ATTRIBUTE);
      let videoUrl = "";

      const isVideoFileUrlFound = videoFileUrl != null && videoFileUrl !== "";
      const isFallbackUrlFound = fallbackUrl != null && fallbackUrl !== "";
      if (isVideoFileUrlFound) videoUrl = videoFileUrl;
      else if (isFallbackUrlFound) videoUrl = fallbackUrl;

      const isNodeMissing = node.textContent === null;
      const nodeLabel = isNodeMissing ? "" : node.textContent.trim();

      const isVideoUrlFound = videoUrl !== "";
      const ref = isVideoUrlFound ? readAbsoluteUrl(videoUrl) : nodeLabel;

      const isRefFound = ref !== "";
      if (isRefFound) messages.push({ role: "assistant", content: ref });
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

  const timeout = waitSettings.timeout ?? DEFAULT_GENERATION_TIMEOUT_MILLISECONDS;
  return {
    timeout,
    previousAssistantCount: waitSettings.previousAssistantCount,
  };
};

const isGenerating = async (page: Page): Promise<boolean> => {
  return probeOrFallback(false, () =>
    page.locator(SELECTORS.generatingIndicator).first().isVisible(),
  );
};

const waitForGenerationStart = async (request: {
  page: Page;
  parsed: ParsedWaitSettings;
  startedAt: number;
}): Promise<void> => {
  const baseline = request.parsed.previousAssistantCount ?? 0;
  while (Date.now() - request.startedAt < request.parsed.timeout) {
    const isStillRendering = await isGenerating(request.page);
    if (isStillRendering) return;

    const hasMoreClips = (await countClips(request.page)) > baseline;
    if (hasMoreClips) return;

    await request.page.waitForTimeout(UI_SETTLE_MILLISECONDS);
  }
  throw new Error("Timed out waiting for Flow to start generating a clip.");
};

const waitForGenerationEnd = async (request: {
  page: Page;
  parsed: ParsedWaitSettings;
  startedAt: number;
}): Promise<void> => {
  const baseline = request.parsed.previousAssistantCount ?? 0;
  let lastRef = "";
  let stableSince = Date.now();
  while (Date.now() - request.startedAt < request.parsed.timeout) {
    const generating = await isGenerating(request.page);
    const count = await countClips(request.page);

    const ref = cleanVisibleCopy(await probeOrFallback("", () => captureLastClipRef(request.page)));

    const hasRefChanged = ref !== lastRef;
    if (hasRefChanged) {
      lastRef = ref;
      stableSince = Date.now();
    }

    if (
      isTurnSettled({
        hasClip: count > baseline && !!ref,
        generating,
        stableForMilliseconds: Date.now() - stableSince,
      })
    )
      return;

    const generationEndPollMilliseconds = 1_000;

    await request.page.waitForTimeout(generationEndPollMilliseconds);
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
  const promptFieldVisibilityTimeoutMilliseconds = 2_500;

  const isPromptFieldVisible = await probeOrFallback(false, () =>
    promptField.isVisible({ timeout: promptFieldVisibilityTimeoutMilliseconds }),
  );
  if (isPromptFieldVisible) return false;

  const signIn = page.locator(SELECTORS.signInButton).first();
  const signInVisibilityTimeoutMilliseconds = 1_500;

  return probeOrFallback(true, () =>
    signIn.isVisible({ timeout: signInVisibilityTimeoutMilliseconds }),
  );
};

const assertSignedIn = async (page: Page): Promise<void> => {
  const isGuestSessionDetected = await isGuestSession(page);
  if (isGuestSessionDetected) {
    throw createGuestSessionError({
      providerId: FLOW_PROVIDER_ID,
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
    const href = await link.getAttribute(HREF_ATTRIBUTE);

    const isHrefEmpty = !href;
    if (isHrefEmpty) continue;

    const title = cleanVisibleCopy(await probeOrFallback("", () => readVisibleCopy(link)));
    const isAbsoluteHref = href.startsWith("http");
    const url = isAbsoluteHref ? href : `https://labs.google${href}`;
    const pathSegment = href.split("/").filter(Boolean).pop();
    const isPathSegmentMissing = pathSegment == null;
    const id = isPathSegmentMissing ? href : pathSegment;
    projects.push({ id, title: title || id, url });
  }
  return projects;
};

const navigateToConversation = async (page: Page, url: string): Promise<void> => {
  await page.goto(url, { waitUntil: HTML_PARSED_WAIT });
  await probeOrFallback(null, () =>
    page.waitForSelector(SELECTORS.promptInput, {
      timeout: PROMPT_FIELD_WAIT_TIMEOUT_MILLISECONDS,
    }),
  );
};

const startNewConversation = async (page: Page): Promise<void> => {
  await page.goto(FLOW_TOOL_URL, { waitUntil: HTML_PARSED_WAIT });
  await probeOrFallback(null, () =>
    page.waitForSelector(SELECTORS.promptInput, {
      timeout: PROMPT_FIELD_WAIT_TIMEOUT_MILLISECONDS,
    }),
  );
};

const readFirstVisible = async (parameters: {
  page: Page;
  selector: string;
}): Promise<Locator | null> => {
  const locator = parameters.page.locator(parameters.selector);
  const count = await locator.count();
  for (let i = 0; i < count; i += 1) {
    const candidate = locator.nth(i);

    const isCandidateVisible = await probeOrFallback(false, () => candidate.isVisible());
    if (isCandidateVisible) return candidate;
  }
  return null;
};

const detectCurrentModel = async (page: Page): Promise<string> => {
  return probeOrFallback(VEO_MODEL_LABEL, async () => {
    const trigger = await readFirstVisible({ page, selector: SELECTORS.modelTrigger });

    const isTriggerMissing = trigger == null;
    if (isTriggerMissing) return VEO_MODEL_LABEL;

    const triggerLabel = cleanVisibleCopy(
      await probeOrFallback("", () => readVisibleCopy(trigger)),
    );
    const line = triggerLabel.split("\n").find((part) => isLikelyModelLabel(part));

    const isLineMissing = line == null;
    if (isLineMissing) return VEO_MODEL_LABEL;

    return line;
  });
};

const listAvailableModels = async (page: Page): Promise<ModelOption[]> => {
  const trigger = await readFirstVisible({ page, selector: SELECTORS.modelTrigger });

  const isTriggerMissing = trigger == null;
  if (isTriggerMissing) return [];

  await probeOrFallback(null, () => trigger.click());
  await probeOrFallback(null, () =>
    page.waitForSelector(SELECTORS.openMenu, { timeout: MENU_WAIT_TIMEOUT_MILLISECONDS }),
  );
  const menuElements = page.locator(
    `${SELECTORS.openMenu} [role="menuitem"], ${SELECTORS.openMenu} [role="option"]`,
  );
  const count = await menuElements.count();
  const models: ModelOption[] = [];
  for (let i = 0; i < count; i += 1) {
    const label = cleanVisibleCopy(
      await probeOrFallback("", () => readVisibleCopy(menuElements.nth(i))),
    );

    const isLabelUnusable = !label || !isLikelyModelLabel(label);
    if (isLabelUnusable) continue;

    models.push({ id: label.toLowerCase().replace(/\s+/g, HYPHEN), label, selected: false });
  }
  await probeOrFallback(null, () => page.keyboard.press(ESCAPE_KEY));
  return models;
};

const selectModel = async (page: Page, query: string): Promise<string> => {
  const models = await listAvailableModels(page);
  const normalized = query.trim().toLowerCase();

  const matchedModel = models.find(
    (model) =>
      model.label.toLowerCase().includes(normalized) ||
      model.id.includes(normalized.replace(/\s+/g, HYPHEN)),
  );

  const isMatchedModelMissing = !matchedModel;
  if (isMatchedModelMissing) throw new Error(`Model not found in Flow picker: ${query}`);

  const trigger = await readFirstVisible({ page, selector: SELECTORS.modelTrigger });

  const isTriggerMissing = trigger == null;
  if (isTriggerMissing) throw new Error("Flow model picker is not available.");

  await trigger.click();
  await page.waitForSelector(SELECTORS.openMenu, { timeout: MENU_WAIT_TIMEOUT_MILLISECONDS });
  await page
    .locator(`${SELECTORS.openMenu} [role="menuitem"], ${SELECTORS.openMenu} [role="option"]`)
    .filter({ hasText: matchedModel.label })
    .first()
    .click();
  await probeOrFallback(null, () => page.keyboard.press(ESCAPE_KEY));
  return matchedModel.label;
};

const rewindLastUserPrompt = async (_page: Page, _replacement?: string): Promise<void> => {
  throw new Error("Rewind is not supported on Google Flow yet.");
};

const stopGenerating = async (
  page: Page,
  timeout = CONTROL_WAIT_TIMEOUT_MILLISECONDS,
): Promise<boolean> => {
  const stop = page.locator(SELECTORS.cancelButton).first();
  const stopButtonVisibilityTimeoutMilliseconds = 1_000;

  const isStopVisible = await probeOrFallback(false, () =>
    stop.isVisible({ timeout: stopButtonVisibilityTimeoutMilliseconds }),
  );

  if (isStopVisible) {
    await stop.click({ timeout });
    return true;
  }

  return false;
};

const attachFilesToPrompt = async (page: Page, paths: string[]): Promise<void> => {
  const isPathsEmpty = paths.length === 0;
  if (isPathsEmpty) return;

  const ingredients = paths.slice(0, MAX_INGREDIENTS);

  const ingredientField = page.locator(SELECTORS.ingredientInput).first();
  const ingredientFieldCount = await ingredientField.count();

  const hasIngredientField = ingredientFieldCount > 0;
  if (hasIngredientField) {
    await ingredientField.setInputFiles(ingredients);
    return;
  }

  const button = page.locator(SELECTORS.ingredientButton).first();
  const attachmentVisibilityTimeoutMilliseconds = 2_000;

  const buttonVisible = await probeOrFallback(false, () =>
    button.isVisible({ timeout: attachmentVisibilityTimeoutMilliseconds }),
  );

  const isButtonHidden = !buttonVisible;
  if (isButtonHidden) {
    throw new Error("Flow ingredient upload controls are not available on this page.");
  }

  await button.click();
  const fileUpload = page.locator(SELECTORS.ingredientInput).first();
  await fileUpload.waitFor({ state: "attached", timeout: CONTROL_WAIT_TIMEOUT_MILLISECONDS });
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

    // biome-ignore lint/performance/useDomNodeTextContent: the composer text must match what the user sees
    return editor.innerText.trim();
  });
};

const clickGenerateOrEnter = async (page: Page): Promise<void> => {
  const generate = page.locator(SELECTORS.generateButton).filter({ visible: true }).first();

  // The generate button may never surface; then Enter runs unless a render is running.
  const isGenerateClicked = await probeOrFallback(false, async () => {
    await generate.waitFor({ state: "visible", timeout: CONTROL_WAIT_TIMEOUT_MILLISECONDS });
    await generate.click();
    return true;
  });
  if (isGenerateClicked) return;

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
  const maxComposerClearChecks = 10;

  for (let poll = 0; poll < maxComposerClearChecks; poll += 1) {
    const isComposerEmpty = (await readComposerDraft(parameters.page)) === "";
    if (isComposerEmpty) return true;

    await parameters.page.waitForTimeout(UI_SETTLE_MILLISECONDS);
  }
  return false;
};

export const injectPrompt = async (page: Page, prompt: string): Promise<void> => {
  await probeOrFallback(null, () => page.bringToFront());
  const promptField = page.locator(SELECTORS.promptInput).filter({ visible: true }).first();
  const maxPromptInjectAttempts = 3;

  for (let attempt = 0; attempt < maxPromptInjectAttempts; attempt += 1) {
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
  return cleanVisibleCopy(await probeOrFallback("", () => captureLastClipRef(page)));
};

export const flowProvider = {
  id: FLOW_PROVIDER_ID,
  origin: "labs.google",
  defaultUrl: FLOW_TOOL_URL,
  defaultModel: VEO_MODEL_LABEL,
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
