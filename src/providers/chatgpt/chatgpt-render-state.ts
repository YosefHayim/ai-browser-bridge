import type { Page } from "playwright";
import {
  countExpectedImageMarkers,
  LIST_GENERATED_IMAGES_ORIGIN,
  SELECTORS,
} from "./chatgpt-page.ts";

// Assistant text meaning the image tool refused / misfired instead of generating —
// e.g. "couldn't generate…", "treated this as an edit", "required an upload target".
const MISFIRE_STRING =
  /can'?t generate|couldn'?t generate|as an edit|upload target|unable to (?:create|generate)/i;

// Rate/usage/image-cap or unavailability notice — e.g. "you've hit the image generation
// limit", "try again later", "too many requests", "can't create images right now".
const IMAGE_LIMIT_NOTICE =
  /image (?:generation )?(?:limit|cap)|reached your|rate limit|try again (?:later|in)|come back|upgrade to|you'?ve hit|too many requests|unavailable right now|can'?t create images/i;

const MAX_STRING_CHARS = 600;

// In-page snapshot of raw DOM facts. Selectors are interpolated from SELECTORS so this
// never drifts from the settle path. Exotic DOM reads live in String.raw (same idiom as
// chatgptPage.ts) and need no DOM lib types at compile time.
const UNPARSED_RENDER_STATUS_ORIGIN = String.raw`
(() => {
  const norm = (value) => {
    if (!value) return "";
    return value.replace(/\s+/g, " ").trim();
  };
  const streamingSelector = ${JSON.stringify(SELECTORS.streamingIndicator)};
  ${LIST_GENERATED_IMAGES_ORIGIN}
  const turns = Array.from(document.querySelectorAll(${JSON.stringify(SELECTORS.conversationTurn)}));
  const areThereTurns = turns.length > 0;
  const scopes = areThereTurns ? turns : [document];
  const images = scopes.flatMap(listGeneratedImagesIn);
  let loaded = 0;
  let pending = 0;
  for (const node of images) {
    if (node instanceof HTMLImageElement && node.complete && node.naturalWidth > 0) loaded += 1;
    else pending += 1;
  }

  const assistants = Array.from(document.querySelectorAll(${JSON.stringify(SELECTORS.responseBlock)}));
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
    lastAssistantText: norm(lastText).slice(0, ${MAX_STRING_CHARS}),
    noticeCandidates: noticeCandidates,
  };
})()
`;

type RenderImageCounts = {
  loaded: number;
  pending: number;
  total: number;
};

export type UnparsedChatGptRenderStatus = {
  streaming: boolean;
  assistantTurnCount: number;
  images: RenderImageCounts;
  lastAssistantText: string;
  noticeCandidates: string[];
};

export type ChatGptRenderStatus = {
  streaming: boolean;
  assistantTurnCount: number;
  images: RenderImageCounts;
  expectedImageMarkers: number;
  misfireSuspected: boolean;
  limitHit: boolean;
  limitNotice: string | null;
  lastAssistantText: string;
};

export type ChatGptTabRenderStatus = ChatGptRenderStatus & {
  url: string;
};

// Pure so the regex policy is unit-testable without a browser (mirrors isTurnSettled).
export const classifyRenderStatus = (
  unparsed: UnparsedChatGptRenderStatus,
): ChatGptRenderStatus => {
  const matchedNotice = [unparsed.lastAssistantText, ...unparsed.noticeCandidates]
    .map((line) => {
      const hit = IMAGE_LIMIT_NOTICE.exec(line);
      const isHitMissing = hit == null;
      if (isHitMissing) return undefined;

      return hit[0];
    })
    .find((hit): hit is string => hit != null);
  const isMatchedNoticeMissing = matchedNotice == null;
  const limitNotice = isMatchedNoticeMissing ? null : matchedNotice;
  return {
    streaming: unparsed.streaming,
    assistantTurnCount: unparsed.assistantTurnCount,
    images: unparsed.images,
    expectedImageMarkers: countExpectedImageMarkers(unparsed.lastAssistantText),
    misfireSuspected:
      unparsed.images.total === 0 && MISFIRE_STRING.test(unparsed.lastAssistantText),
    limitHit: limitNotice != null,
    limitNotice,
    lastAssistantText: unparsed.lastAssistantText,
  };
};

const evaluateUnparsedRenderStatus = async (page: Page): Promise<UnparsedChatGptRenderStatus> => {
  return (await page.evaluate(UNPARSED_RENDER_STATUS_ORIGIN)) as UnparsedChatGptRenderStatus;
};

export const readChatGptRenderStatus = async (page: Page): Promise<ChatGptRenderStatus> => {
  return classifyRenderStatus(await evaluateUnparsedRenderStatus(page));
};

// Sweep every ChatGPT tab so a background --fresh run on another tab can be located.
// Tabs that navigate or close mid-read are skipped rather than failing the whole sweep.
export const readAllChatGptTabRenderStatuses = async (
  page: Page,
): Promise<ChatGptTabRenderStatus[]> => {
  const tabs = page.context().pages();
  const tabStatuses: ChatGptTabRenderStatus[] = [];
  for (const tab of tabs) {
    const isNotChatGptTab = !tab.url().includes("chatgpt.com");
    if (isNotChatGptTab) continue;

    let unparsed: UnparsedChatGptRenderStatus | null = null;
    try {
      unparsed = await evaluateUnparsedRenderStatus(tab);
    } catch {
      unparsed = null;
    }

    if (unparsed == null) continue;

    tabStatuses.push({ url: tab.url(), ...classifyRenderStatus(unparsed) });
  }
  return tabStatuses;
};
