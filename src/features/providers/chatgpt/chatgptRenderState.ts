import type { Page } from "playwright";
import { countExpectedImageMarkers, SELECTORS } from "./chatgptPage.ts";

// Assistant text meaning the image tool refused / misfired instead of generating —
// e.g. "couldn't generate…", "treated this as an edit", "required an upload target".
const MISFIRE_TEXT =
  /can'?t generate|couldn'?t generate|as an edit|upload target|unable to (?:create|generate)/i;

// Rate/usage/image-cap or unavailability notice — e.g. "you've hit the image generation
// limit", "try again later", "too many requests", "can't create images right now".
const IMAGE_LIMIT_NOTICE =
  /image (?:generation )?(?:limit|cap)|reached your|rate limit|try again (?:later|in)|come back|upgrade to|you'?ve hit|too many requests|unavailable right now|can'?t create images/i;

const MAX_TEXT_CHARS = 600;

// In-page snapshot of raw DOM facts. Selectors are interpolated from SELECTORS so this
// never drifts from the settle path. Exotic DOM reads live in String.raw (same idiom as
// chatgptPage.ts) and need no DOM lib types at compile time.
const RAW_RENDER_STATE_SOURCE = String.raw`
(() => {
  const norm = (value) => {
    if (!value) return "";
    return value.replace(/\s+/g, " ").trim();
  };
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
  let lastText = "";
  if (last !== undefined) {
    if (last instanceof HTMLElement) {
      lastText = last.innerText;
    } else if (last.textContent !== null) {
      lastText = last.textContent;
    }
  }

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

export type RenderImageCounts = {
  loaded: number;
  pending: number;
  total: number;
};

export type RawChatGptRenderState = {
  streaming: boolean;
  assistantTurnCount: number;
  images: RenderImageCounts;
  lastAssistantText: string;
  noticeCandidates: string[];
};

export type ChatGptRenderState = {
  streaming: boolean;
  assistantTurnCount: number;
  images: RenderImageCounts;
  expectedImageMarkers: number;
  misfireSuspected: boolean;
  limitHit: boolean;
  limitNotice: string | null;
  lastAssistantText: string;
};

export type ChatGptTabRenderState = ChatGptRenderState & {
  url: string;
};

// Pure so the regex policy is unit-testable without a browser (mirrors isTurnSettled).
export const classifyRenderState = (raw: RawChatGptRenderState): ChatGptRenderState => {
  const matchedNotice = [raw.lastAssistantText, ...raw.noticeCandidates]
    .map((line) => {
      const match = IMAGE_LIMIT_NOTICE.exec(line);
      if (match === null) return undefined;
      return match[0];
    })
    .find((match): match is string => match !== undefined);
  const limitNotice = matchedNotice === undefined ? null : matchedNotice;
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

const evaluateRawRenderState = async (page: Page): Promise<RawChatGptRenderState> => {
  return (await page.evaluate(RAW_RENDER_STATE_SOURCE)) as RawChatGptRenderState;
};

export const readChatGptRenderState = async (page: Page): Promise<ChatGptRenderState> => {
  return classifyRenderState(await evaluateRawRenderState(page));
};

// Sweep every ChatGPT tab so a background --fresh run on another tab can be located.
// Tabs that navigate or close mid-read are skipped rather than failing the whole sweep.
export const readAllChatGptTabRenderStates = async (
  page: Page,
): Promise<ChatGptTabRenderState[]> => {
  const tabs = page.context().pages();
  const tabStates: ChatGptTabRenderState[] = [];
  for (const tab of tabs) {
    if (!tab.url().includes("chatgpt.com")) continue;
    let raw: RawChatGptRenderState | null = null;
    try {
      raw = await evaluateRawRenderState(tab);
    } catch {
      raw = null;
    }
    if (raw === null) continue;
    tabStates.push({ url: tab.url(), ...classifyRenderState(raw) });
  }
  return tabStates;
};
