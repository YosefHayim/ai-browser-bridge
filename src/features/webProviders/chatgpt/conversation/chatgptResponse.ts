import type { Page, Response } from "playwright";
import { stallReloadWatchdogFor } from "../../streaming/renderStallWatchdog.ts";
import { isResponseGenerating } from "../../streaming/streamingGuard.ts";
import {
  captureLastResponse,
  LAST_ASSISTANT_TURN_STATE_SOURCE,
} from "../content/chatgptAttachments.ts";
import { normalizeDisplayText, SELECTORS, waitForComposerReady } from "./chatgptControls.ts";

type RemainingTimeoutContext = {
  startedAt: number;
  timeout: number;
};

type ResponseStartedAfterBaselineContext = {
  page: Page;
  previousAssistantCount?: number;
  previousLastAssistantText?: string;
};

type ResponseWaitOptions = {
  timeout?: number;
  previousAssistantCount?: number;
  previousLastAssistantText?: string;
  expectImages?: number;
};

type TurnSettledState = {
  hasText: boolean;
  isTransientText: boolean;
  assetCount: number;
  loadedAssetCount: number;
  pendingAssetCount: number;
  expectedImageMarkerCount: number;
  streaming: boolean;
  stableForMs: number;
  expectImages: number;
  sawImageActivity: boolean;
  msSinceImageActivity: number;
};

type TurnSnapshot = {
  text: string;
  streaming: boolean;
  assetCount: number;
  loadedAssetCount: number;
  pendingAssetCount: number;
  expectedImageMarkerCount: number;
};

type LastAssistantTurnState = {
  text: string;
  assetCount: number;
  loadedAssetCount: number;
  pendingAssetCount: number;
  expectedImageMarkerCount: number;
};

type TurnSnapshotSettledContext = {
  snapshot: TurnSnapshot;
  stableForMs: number;
  expectImages: number;
  msSinceImageActivity: number;
  sawImageActivity: boolean;
};

type WaitForLastAssistantTextStableContext = {
  page: Page;
  timeout: number;
  expectImages: number;
  imageActivity: ImageNetworkActivity;
};

type WaitForResponseAfterBaselineContext = {
  page: Page;
  previousAssistantCount?: number;
  previousLastAssistantText?: string;
  timeout: number;
};

type ImageNetworkActivity = {
  msSinceLastActivity(): number;
  sawActivity(): boolean;
  dispose(): void;
};

type WaitForStreamingToFinishContext = {
  page: Page;
  startedAt: number;
  timeout: number;
};

/** Quiet window a plain text turn must hold before it counts as settled. */
const SETTLE_QUIET_MS = 1_500;

const ASSET_SETTLE_QUIET_MS = 12_000;

/** Quiet window after which an image turn that fell short of its requested/announced count
 *  is treated as finished, so a stopped-short generation never hangs to the full timeout. */
const IMAGE_STALL_QUIET_MS = 45_000;

/** URL fragments that signal a generated image tile arriving over the network. */
// Raw row example: "https://oaiusercontent.com/..." image activity URL should match.
const IMAGE_ACTIVITY_URL = /estuary\/content|oaiusercontent\.com/i;

const isTransientAssistantText = (text: string): boolean => {
  const normalized = text.trim().toLowerCase();
  return (
    normalized === "thinking" ||
    normalized.endsWith(" thinking") ||
    normalized.endsWith(" thinking...") ||
    /^thinking[.\s]*$/.test(normalized) ||
    /^thought for\b/.test(normalized) ||
    normalized.startsWith("thought for ")
  );
};

export const isTurnSettled = (state: TurnSettledState): boolean => {
  if (state.streaming) return false;
  if (state.pendingAssetCount > 0) return false;
  const targetImageCount = Math.max(state.expectImages, state.expectedImageMarkerCount);
  const awaitingImages = targetImageCount > 0 || state.sawImageActivity || state.assetCount > 0;

  // An image turn must also see the image network fall quiet: every tile that lands resets
  // msSinceImageActivity, so a turn streaming several images never settles between them.
  if (awaitingImages && state.msSinceImageActivity < ASSET_SETTLE_QUIET_MS) return false;

  // Fewer tiles have loaded than were requested (via --images) or announced (via [image-N]
  // markers): keep waiting, unless generation has clearly stalled — then settle with what
  // loaded so a short generation never hangs to the full timeout.
  if (targetImageCount > 0 && state.loadedAssetCount < targetImageCount) {
    return state.stableForMs >= IMAGE_STALL_QUIET_MS;
  }
  const requiredQuietMs = awaitingImages ? ASSET_SETTLE_QUIET_MS : SETTLE_QUIET_MS;
  if (state.stableForMs < requiredQuietMs) return false;
  if (state.loadedAssetCount > 0) return true;
  if (targetImageCount > 0) return false;
  return state.hasText && !state.isTransientText;
};

const remainingTimeout = (remainingTimeoutContext: RemainingTimeoutContext): number => {
  return Math.max(
    1_000,
    remainingTimeoutContext.timeout - (Date.now() - remainingTimeoutContext.startedAt),
  );
};

const responseStartedAfterBaseline = async (
  responseStartedAfterBaselineContext: ResponseStartedAfterBaselineContext,
): Promise<boolean> => {
  if (await isStreamingVisible(responseStartedAfterBaselineContext.page)) return true;
  const count = await responseStartedAfterBaselineContext.page
    .locator(SELECTORS.responseBlock)
    .count();
  if (
    responseStartedAfterBaselineContext.previousAssistantCount !== undefined &&
    count > responseStartedAfterBaselineContext.previousAssistantCount
  )
    return true;
  const lastText = await readNormalizedLastResponse(responseStartedAfterBaselineContext.page);
  return (
    !!responseStartedAfterBaselineContext.previousLastAssistantText &&
    !!lastText &&
    lastText !== responseStartedAfterBaselineContext.previousLastAssistantText
  );
};

export const isStreamingVisible = async (page: Page): Promise<boolean> => {
  return isResponseGenerating(page, SELECTORS.streamingIndicator);
};

const readNormalizedLastResponse = async (page: Page): Promise<string> => {
  const text = await captureLastResponse(page).catch(() => "");
  return normalizeDisplayText(text);
};

export const countExpectedImageMarkers = (text: string): number => {
  const markers = text.match(/\[image-\d+\]/g);
  if (markers === null) return 0;
  return markers.length;
};

const turnSnapshotChanged = (previous: TurnSnapshot, next: TurnSnapshot): boolean => {
  return (
    previous.text !== next.text ||
    previous.assetCount !== next.assetCount ||
    previous.loadedAssetCount !== next.loadedAssetCount ||
    previous.pendingAssetCount !== next.pendingAssetCount ||
    previous.expectedImageMarkerCount !== next.expectedImageMarkerCount
  );
};

const readTurnSnapshot = async (page: Page): Promise<TurnSnapshot> => {
  const turnState = (await page.evaluate(LAST_ASSISTANT_TURN_STATE_SOURCE).catch(() => ({
    text: "",
    assetCount: 0,
    loadedAssetCount: 0,
    pendingAssetCount: 0,
    expectedImageMarkerCount: 0,
  }))) as LastAssistantTurnState;
  const streaming = await isStreamingVisible(page);
  const text = normalizeDisplayText(turnState.text || (await readNormalizedLastResponse(page)));
  const expectedImageMarkerCount = Math.max(
    turnState.expectedImageMarkerCount,
    countExpectedImageMarkers(text),
  );
  return {
    text,
    streaming,
    assetCount: turnState.assetCount,
    loadedAssetCount: turnState.loadedAssetCount,
    pendingAssetCount: turnState.pendingAssetCount,
    expectedImageMarkerCount,
  };
};

const turnSnapshotSettled = (turnSnapshotSettledContext: TurnSnapshotSettledContext): boolean => {
  return isTurnSettled({
    hasText: !!turnSnapshotSettledContext.snapshot.text,
    isTransientText: isTransientAssistantText(turnSnapshotSettledContext.snapshot.text),
    assetCount: turnSnapshotSettledContext.snapshot.assetCount,
    loadedAssetCount: turnSnapshotSettledContext.snapshot.loadedAssetCount,
    pendingAssetCount: turnSnapshotSettledContext.snapshot.pendingAssetCount,
    expectedImageMarkerCount: turnSnapshotSettledContext.snapshot.expectedImageMarkerCount,
    streaming: turnSnapshotSettledContext.snapshot.streaming,
    stableForMs: turnSnapshotSettledContext.stableForMs,
    expectImages: turnSnapshotSettledContext.expectImages,
    msSinceImageActivity: turnSnapshotSettledContext.msSinceImageActivity,
    sawImageActivity: turnSnapshotSettledContext.sawImageActivity,
  });
};

const waitForLastAssistantTextStable = async (
  waitForLastAssistantTextStableContext: WaitForLastAssistantTextStableContext,
): Promise<void> => {
  const startedAt = Date.now();
  // Recover a render stuck against a stale DOM (lingering stop indicator, tiles that never
  // re-render): when nothing progresses for RENDER_STALL_RELOAD_MS, reload the tab to re-sync
  // with server truth. Real progress (text/asset change or a fresh image response) resets it,
  // so a genuinely-streaming long render is never interrupted.
  const watchdog = stallReloadWatchdogFor({
    waitAfterReload: waitForComposerReady,
    onReload: (count) =>
      process.stderr.write(`[bridge] ChatGPT render stalled — reloaded tab (reload ${count}).\n`),
  });
  let lastSnapshot = await readTurnSnapshot(waitForLastAssistantTextStableContext.page);
  let stableSince = Date.now();
  while (Date.now() - startedAt < waitForLastAssistantTextStableContext.timeout) {
    const snapshot = await readTurnSnapshot(waitForLastAssistantTextStableContext.page);
    if (turnSnapshotChanged(lastSnapshot, snapshot)) {
      lastSnapshot = snapshot;
      stableSince = Date.now();
      watchdog.noteProgress();
    } else if (
      waitForLastAssistantTextStableContext.imageActivity.sawActivity() &&
      waitForLastAssistantTextStableContext.imageActivity.msSinceLastActivity() <
        ASSET_SETTLE_QUIET_MS
    ) {
      // A generated-image tile just arrived over the network even if the DOM count has not
      // updated yet — count that as progress so a live image stream is never reloaded.
      watchdog.noteProgress();
    }
    if (
      turnSnapshotSettled({
        snapshot,
        stableForMs: Date.now() - stableSince,
        expectImages: waitForLastAssistantTextStableContext.expectImages,
        msSinceImageActivity:
          waitForLastAssistantTextStableContext.imageActivity.msSinceLastActivity(),
        sawImageActivity: waitForLastAssistantTextStableContext.imageActivity.sawActivity(),
      })
    )
      return;
    if (await watchdog.maybeReload(waitForLastAssistantTextStableContext.page)) {
      // Re-baseline after the reload so the settle timer never fires on pre-reload reads.
      lastSnapshot = await readTurnSnapshot(waitForLastAssistantTextStableContext.page);
      stableSince = Date.now();
      continue;
    }
    await waitForLastAssistantTextStableContext.page.waitForTimeout(500);
  }
  throw new Error("Timed out waiting for ChatGPT response to settle.");
};

const waitForResponseAfterBaseline = async (
  waitForResponseAfterBaselineContext: WaitForResponseAfterBaselineContext,
): Promise<void> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < waitForResponseAfterBaselineContext.timeout) {
    if (await responseStartedAfterBaseline(waitForResponseAfterBaselineContext)) return;
    await waitForResponseAfterBaselineContext.page.waitForTimeout(250);
  }
  throw new Error("Timed out waiting for ChatGPT to start a new response.");
};

const trackImageNetworkActivity = (page: Page): ImageNetworkActivity => {
  let lastActivityAt = 0;
  const onResponse = (browserResponse: Response): void => {
    if (IMAGE_ACTIVITY_URL.test(browserResponse.url())) lastActivityAt = Date.now();
  };
  page.on("response", onResponse);
  return {
    msSinceLastActivity: () =>
      lastActivityAt === 0 ? Number.POSITIVE_INFINITY : Date.now() - lastActivityAt,
    sawActivity: () => lastActivityAt !== 0,
    dispose: () => page.off("response", onResponse),
  };
};

export const waitForResponse = async (
  page: Page,
  options: number | ResponseWaitOptions = {},
): Promise<void> => {
  const parsed = parseResponseWaitOptions(options);
  const startedAt = Date.now();
  const imageActivity = trackImageNetworkActivity(page);
  try {
    if (parsed.previousAssistantCount !== undefined || parsed.previousLastAssistantText) {
      await waitForResponseAfterBaseline({ page, ...parsed });
    } else {
      await page.waitForSelector(SELECTORS.responseBlock, { timeout: parsed.timeout });
    }
    await waitForStreamingToFinish({ page, startedAt, timeout: parsed.timeout });
    await waitForLastAssistantTextStable({
      page,
      timeout: remainingTimeout({ startedAt, timeout: parsed.timeout }),
      expectImages: parsed.expectImages === undefined ? 0 : parsed.expectImages,
      imageActivity,
    });
  } finally {
    imageActivity.dispose();
  }
};

const waitForStreamingToFinish = async (
  waitForStreamingToFinishContext: WaitForStreamingToFinishContext,
): Promise<void> => {
  try {
    await waitForStreamingToFinishContext.page
      .locator(SELECTORS.streamingIndicator)
      .waitFor({ state: "visible", timeout: 10_000 });
    await waitForStreamingToFinishContext.page.locator(SELECTORS.streamingIndicator).waitFor({
      state: "hidden",
      timeout: remainingTimeout({
        startedAt: waitForStreamingToFinishContext.startedAt,
        timeout: waitForStreamingToFinishContext.timeout,
      }),
    });
  } catch {
    // Response might already be complete
  }
};

const parseResponseWaitOptions = (
  options: number | ResponseWaitOptions,
): {
  timeout: number;
  previousAssistantCount?: number;
  previousLastAssistantText?: string;
  expectImages?: number;
} => {
  if (typeof options === "number") {
    return { timeout: options };
  }
  return {
    timeout: options.timeout === undefined ? 300_000 : options.timeout,
    previousAssistantCount: options.previousAssistantCount,
    previousLastAssistantText: normalizeDisplayText(
      options.previousLastAssistantText === undefined ? "" : options.previousLastAssistantText,
    ),
    expectImages: options.expectImages,
  };
};
