import type { Page } from "playwright";
import { SELECTORS, countExpectedImageMarkers } from "./chatgptPage.ts";

// Assistant text meaning the image tool refused / misfired instead of generating — e.g.
// "couldn't generate…", "treated this as an edit", "required an upload target".
const MISFIRE_TEXT =
  /can'?t generate|couldn'?t generate|as an edit|upload target|unable to (?:create|generate)/i;

// A rate/usage/image-cap or unavailability notice — e.g. "you've hit the image generation
// limit", "try again later", "too many requests", "can't create images right now".
const IMAGE_LIMIT_NOTICE =
  /image (?:generation )?(?:limit|cap)|reached your|rate limit|try again (?:later|in)|come back|upgrade to|you'?ve hit|too many requests|unavailable right now|can'?t create images/i;

/** Max characters of assistant text carried in a render-state snapshot. */
const MAX_TEXT_CHARS = 600;

// In-page snapshot returning the raw DOM facts as a JSON-serializable object. Selectors are
// interpolated from the SSOT SELECTORS so this never drifts from the settle path. The exotic
// DOM reads (naturalWidth/complete/innerText) live in a String.raw snippet — the same idiom
// chatgptPage.ts uses — so they need no DOM lib types at compile time.
const RAW_RENDER_STATE_SOURCE = String.raw`
(() => {
  // Collapse runs of whitespace so text compares/truncates predictably.
  const norm = (value) => (value || "").replace(/\s+/g, " ").trim();
  const streamingSelector = ${JSON.stringify(SELECTORS.streamingIndicator)};
  const imageSelector = ${JSON.stringify(SELECTORS.generatedImage)};

  const images = Array.from(document.querySelectorAll(imageSelector));
  let loaded = 0;
  let pending = 0;
  for (const node of images) {
    if (node instanceof HTMLImageElement && node.complete && node.naturalWidth > 0) loaded += 1;
    else pending += 1;
  }

  const assistants = Array.from(document.querySelectorAll('[data-message-author-role="assistant"]'));
  const last = assistants[assistants.length - 1];
  const lastText = last ? (last instanceof HTMLElement ? last.innerText : last.textContent || "") : "";

  const bodyText = document.body ? document.body.innerText : "";
  const noticeCandidates = bodyText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.length < 200)
    .slice(-40);

  return {
    streaming: Boolean(document.querySelector(streamingSelector)),
    assistantTurnCount: assistants.length,
    images: { loaded: loaded, pending: pending, total: images.length },
    lastAssistantText: norm(lastText).slice(0, ${MAX_TEXT_CHARS}),
    noticeCandidates: noticeCandidates,
  };
})()
`;

/** Generated-image loaded/pending/total tallies for the current render. */
export interface RenderImageCounts {
  /** Generated images that finished decoding (`complete` with a non-zero natural width). */
  loaded: number;
  /** Generated images still loading or not yet decoded. */
  pending: number;
  /** Total generated-image tiles matched in the DOM. */
  total: number;
}

/** DOM facts read from a ChatGPT tab before classification. */
export interface RawChatGptRenderState {
  /** Whether a stop/streaming indicator is present. */
  streaming: boolean;
  /** Number of assistant message blocks in the conversation. */
  assistantTurnCount: number;
  /** Generated-image tallies for the current render. */
  images: RenderImageCounts;
  /** Normalized, truncated text of the latest assistant message. */
  lastAssistantText: string;
  /** Short body lines that may hold a rate-limit / cap toast. */
  noticeCandidates: string[];
}

/** Consolidated "what is the render doing now" snapshot for a ChatGPT tab. */
export interface ChatGptRenderState {
  /** Whether a stop/streaming indicator is present (a turn is still rendering). */
  streaming: boolean;
  /** Number of assistant message blocks in the conversation. */
  assistantTurnCount: number;
  /** Generated-image tallies for the current render. */
  images: RenderImageCounts;
  /** Count of `[image-N]` markers announced in the latest assistant text. */
  expectedImageMarkers: number;
  /** True when the image tool likely misfired (no tiles + a refusal in the text). */
  misfireSuspected: boolean;
  /** True when a rate-limit / image-cap / unavailability notice was detected. */
  limitHit: boolean;
  /** The matched limit-notice phrase, or null when none. */
  limitNotice: string | null;
  /** Normalized, truncated text of the latest assistant message. */
  lastAssistantText: string;
}

/** A {@link ChatGptRenderState} tagged with the tab URL it was read from. */
export interface ChatGptTabRenderState extends ChatGptRenderState {
  /** URL of the ChatGPT tab this state was read from. */
  url: string;
}

/**
 * Classify raw DOM facts into the misfire / limit / marker flags.
 *
 * Pure so the regex policy is unit-testable without a browser, mirroring `isTurnSettled`.
 *
 * @param raw - DOM facts read by {@link readChatGptRenderState}.
 * @returns The consolidated render state.
 * @example
 * ```ts
 * const state = classifyRenderState(raw);
 * ```
 */
export const classifyRenderState = (raw: RawChatGptRenderState): ChatGptRenderState => {
  // match[0] is the whole matched notice phrase; the assistant text is checked first.
  const limitNotice =
    [raw.lastAssistantText, ...raw.noticeCandidates]
      .map((line) => line.match(IMAGE_LIMIT_NOTICE)?.[0])
      .find((match): match is string => Boolean(match)) ?? null;
  return {
    streaming: raw.streaming,
    assistantTurnCount: raw.assistantTurnCount,
    images: raw.images,
    expectedImageMarkers: countExpectedImageMarkers(raw.lastAssistantText),
    misfireSuspected: raw.images.total === 0 && MISFIRE_TEXT.test(raw.lastAssistantText),
    limitHit: limitNotice !== null,
    limitNotice,
    lastAssistantText: raw.lastAssistantText,
  };
};

/** Read the raw render-state facts from one ChatGPT tab. */
const evaluateRawRenderState = async (page: Page): Promise<RawChatGptRenderState> => {
  return (await page.evaluate(RAW_RENDER_STATE_SOURCE)) as RawChatGptRenderState;
};

/**
 * Read the current render state of a ChatGPT tab: streaming, generated-image progress,
 * misfire and rate/cap-limit signals, and the latest assistant text.
 *
 * @param page - Playwright page for the ChatGPT tab.
 * @returns The consolidated render state.
 * @example
 * ```ts
 * const state = await readChatGptRenderState(page);
 * ```
 */
export const readChatGptRenderState = async (page: Page): Promise<ChatGptRenderState> => {
  return classifyRenderState(await evaluateRawRenderState(page));
};

/**
 * Read the render state of every ChatGPT tab in the page's browser context — so a background
 * `--fresh` run driving a different tab can be located. Tabs that navigate or close mid-read
 * are skipped rather than failing the whole sweep.
 *
 * @param page - Any Playwright page whose context is scanned for ChatGPT tabs.
 * @returns One render state per ChatGPT tab, tagged with its URL.
 * @example
 * ```ts
 * const tabs = await readAllChatGptTabRenderStates(page);
 * ```
 */
export const readAllChatGptTabRenderStates = async (
  page: Page,
): Promise<ChatGptTabRenderState[]> => {
  const tabs = page.context().pages();
  const results: ChatGptTabRenderState[] = [];
  for (const tab of tabs) {
    if (!tab.url().includes("chatgpt.com")) continue;
    const raw = await evaluateRawRenderState(tab).catch(() => null);
    if (raw) results.push({ url: tab.url(), ...classifyRenderState(raw) });
  }
  return results;
};
