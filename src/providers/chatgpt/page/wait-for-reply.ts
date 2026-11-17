import type { Page, Response } from "playwright";
import {
  FIFTEEN_SECONDS_MILLISECONDS,
  HALF_SECOND_MILLISECONDS,
  HIDDEN_WAIT_MODE,
} from "@/providers/chatgpt/page/chatgpt-page-constants.ts";
import { captureLastReply } from "@/providers/chatgpt/page/chatgpt-reply-reader.ts";
import { SELECTORS } from "@/providers/chatgpt/page/chatgpt-selectors.ts";
import { ASSET_SETTLE_QUIET_MILLISECONDS } from "@/providers/chatgpt/page/dom-snapshot-scripts.ts";
import { cleanDisplayString } from "@/providers/chatgpt/page/model-detection.ts";
import {
  readTurnSnapshot,
  turnSnapshotChanged,
  turnSnapshotSettled,
  type WaitForLastAssistantStringStableDetails,
} from "@/providers/chatgpt/page/turn-settled.ts";
import { probeOrFallback } from "@/providers/engine/browser-provider.ts";
import { VISIBLE_WAIT_MODE } from "@/providers/engine/page-probes.ts";
import { createStallReloadWatchdog } from "@/providers/engine/render-stall-watchdog.ts";
import { isReplyGenerating } from "@/providers/engine/streaming-guard.ts";

const NETWORK_REPLY_EVENT = "response";

const QUARTER_SECOND_MILLISECONDS = 250;

type RemainingTimeoutDetails = {
  startedAt: number;
  timeout: number;
};

function readRemainingTimeout(details: RemainingTimeoutDetails): number {
  const minimumRemainingTimeoutMilliseconds = 1_000;

  return Math.max(
    minimumRemainingTimeoutMilliseconds,
    details.timeout - (Date.now() - details.startedAt),
  );
}

type ReplyStartedAfterBaselineDetails = {
  page: Page;
  previousAssistantCount?: number;
  previousLastAssistantText?: string;
};

async function isReplyStartedAfterBaseline(
  details: ReplyStartedAfterBaselineDetails,
): Promise<boolean> {
  const isStreamingShown = await isStreamingVisible({ page: details.page });
  if (isStreamingShown) return true;

  const count = await details.page.locator(SELECTORS.responseBlock).count();

  const isCountAboveBaseline =
    details.previousAssistantCount != null && count > details.previousAssistantCount;
  if (isCountAboveBaseline) return true;

  const lastString = await readNormalizedLastReply({ page: details.page });
  return (
    !!details.previousLastAssistantText &&
    !!lastString &&
    lastString !== details.previousLastAssistantText
  );
}

type ReplyWaitSettings = {
  timeout?: number;
  previousAssistantCount?: number;
  previousLastAssistantText?: string;
  expectImages?: number;
};

type IsStreamingVisibleDetails = {
  page: Page;
};

export async function isStreamingVisible(details: IsStreamingVisibleDetails): Promise<boolean> {
  return isReplyGenerating(details.page, SELECTORS.streamingIndicator);
}

type ReadNormalizedLastReplyDetails = {
  page: Page;
};

export async function readNormalizedLastReply(
  details: ReadNormalizedLastReplyDetails,
): Promise<string> {
  const string = await probeOrFallback("", () => captureLastReply(details.page));
  return cleanDisplayString({ value: string });
}

async function waitForComposerReady(page: Page): Promise<void> {
  await probeOrFallback(null, () =>
    page.waitForSelector(SELECTORS.promptInput, {
      state: VISIBLE_WAIT_MODE,
      timeout: FIFTEEN_SECONDS_MILLISECONDS,
    }),
  );
}

async function waitForLastAssistantStringStable(
  details: WaitForLastAssistantStringStableDetails,
): Promise<void> {
  const startedAt = Date.now();
  // A stale DOM can hold a render forever, so reload the tab once nothing has progressed.
  const watchdog = createStallReloadWatchdog({
    waitAfterReload: waitForComposerReady,
    onReload: (count) =>
      process.stderr.write(`[bridge] ChatGPT render stalled — reloaded tab (reload ${count}).\n`),
  });
  let lastSnapshot = await readTurnSnapshot({ page: details.page });
  let stableSince = Date.now();
  while (Date.now() - startedAt < details.timeout) {
    const snapshot = await readTurnSnapshot({ page: details.page });

    const hasTurnChanged = turnSnapshotChanged(lastSnapshot, snapshot);
    const sawImageActivity = details.imageActivity.sawActivity();
    const millisecondsSinceImageActivity = details.imageActivity.millisecondsSinceLastActivity();
    const isImageActivityRecent =
      sawImageActivity && millisecondsSinceImageActivity < ASSET_SETTLE_QUIET_MILLISECONDS;

    if (hasTurnChanged) {
      lastSnapshot = snapshot;
      stableSince = Date.now();
      watchdog.noteProgress();
    } else if (isImageActivityRecent) {
      // A generated-image tile counts as progress even before the DOM count catches up.
      watchdog.noteProgress();
    }

    const nowMilliseconds = Date.now();

    const isTurnSettled = turnSnapshotSettled({
      snapshot,
      stableForMilliseconds: nowMilliseconds - stableSince,
      expectImages: details.expectImages,
      millisecondsSinceImageActivity: millisecondsSinceImageActivity,
      sawImageActivity,
    });
    if (isTurnSettled) return;

    const hasReloadedPage = await watchdog.reloadIfStalled(details.page);
    if (hasReloadedPage) {
      // Re-baseline after the reload so the settle timer never fires on pre-reload reads.
      lastSnapshot = await readTurnSnapshot({ page: details.page });
      stableSince = Date.now();
      continue;
    }

    await details.page.waitForTimeout(HALF_SECOND_MILLISECONDS);
  }
  throw new Error("Timed out waiting for ChatGPT response to settle.");
}

type WaitForReplyAfterBaselineDetails = {
  page: Page;
  previousAssistantCount?: number;
  previousLastAssistantText?: string;
  timeout: number;
};

async function waitForReplyAfterBaseline(details: WaitForReplyAfterBaselineDetails): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < details.timeout) {
    const hasReplyStarted = await isReplyStartedAfterBaseline(details);
    if (hasReplyStarted) return;

    await details.page.waitForTimeout(QUARTER_SECOND_MILLISECONDS);
  }
  throw new Error("Timed out waiting for ChatGPT to start a new response.");
}

export type ImageNetworkActivity = {
  millisecondsSinceLastActivity(): number;
  sawActivity(): boolean;
  dispose(): void;
};

function trackImageNetworkActivity(page: Page): ImageNetworkActivity {
  let lastActivityAt = 0;
  function saveReplyActivity(reply: Response): void {
    const replyAddress = reply.url();

    const isImageActivityUrl = /estuary\/content|oaiusercontent\.com/i.test(replyAddress);
    if (isImageActivityUrl) lastActivityAt = Date.now();
  }
  page.on(NETWORK_REPLY_EVENT, saveReplyActivity);
  return {
    millisecondsSinceLastActivity: () => {
      const hasNoActivity = lastActivityAt === 0;
      return hasNoActivity ? Number.POSITIVE_INFINITY : Date.now() - lastActivityAt;
    },
    sawActivity: () => lastActivityAt !== 0,
    dispose: () => page.off(NETWORK_REPLY_EVENT, saveReplyActivity),
  };
}

export async function waitForReply(
  page: Page,
  settings: number | ReplyWaitSettings = {},
): Promise<void> {
  const parsed = parseReplyWaitSettings(settings);
  const startedAt = Date.now();
  const imageActivity = trackImageNetworkActivity(page);
  try {
    const hasReplyBaseline =
      parsed.previousAssistantCount != null || Boolean(parsed.previousLastAssistantText);

    if (hasReplyBaseline) {
      await waitForReplyAfterBaseline({ page, ...parsed });
    } else {
      await page.waitForSelector(SELECTORS.responseBlock, { timeout: parsed.timeout });
    }

    await waitForStreamingToFinish({ page, startedAt, timeout: parsed.timeout });
    const remainingWaitTimeout = readRemainingTimeout({ startedAt, timeout: parsed.timeout });
    await waitForLastAssistantStringStable({
      page,
      timeout: remainingWaitTimeout,
      expectImages: parsed.expectImages ?? 0,
      imageActivity,
    });
  } finally {
    imageActivity.dispose();
  }
}

type WaitForStreamingToFinishDetails = {
  page: Page;
  startedAt: number;
  timeout: number;
};

async function waitForStreamingToFinish(details: WaitForStreamingToFinishDetails): Promise<void> {
  // The response might already be complete, so a missing streaming indicator is not an error.
  await probeOrFallback(null, async () => {
    const streamingIndicatorTimeoutMilliseconds = 10_000;

    await details.page
      .locator(SELECTORS.streamingIndicator)
      .waitFor({ state: VISIBLE_WAIT_MODE, timeout: streamingIndicatorTimeoutMilliseconds });
    const remainingStreamTimeout = readRemainingTimeout({
      startedAt: details.startedAt,
      timeout: details.timeout,
    });
    await details.page.locator(SELECTORS.streamingIndicator).waitFor({
      state: HIDDEN_WAIT_MODE,
      timeout: remainingStreamTimeout,
    });
  });
}

function parseReplyWaitSettings(settings: number | ReplyWaitSettings): {
  timeout: number;
  previousAssistantCount?: number;
  previousLastAssistantText?: string;
  expectImages?: number;
} {
  const isTypeNumber = typeof settings === "number";
  if (isTypeNumber) {
    return { timeout: settings };
  }

  const defaultSettingsTimeoutMilliseconds = 300_000;

  return {
    timeout: settings.timeout ?? defaultSettingsTimeoutMilliseconds,
    previousAssistantCount: settings.previousAssistantCount,
    previousLastAssistantText: cleanDisplayString({
      value: settings.previousLastAssistantText ?? "",
    }),
    expectImages: settings.expectImages,
  };
}
