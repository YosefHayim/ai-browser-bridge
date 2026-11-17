import type { Page } from "playwright";
import {
  ASSET_SETTLE_QUIET_MILLISECONDS,
  IMAGE_STALL_QUIET_MILLISECONDS,
  LAST_ASSISTANT_TURN_STATUS_ORIGIN,
  SETTLE_QUIET_MILLISECONDS,
} from "@/providers/chatgpt/page/dom-snapshot-scripts.ts";
import { cleanDisplayString } from "@/providers/chatgpt/page/model-detection.ts";
import {
  type ImageNetworkActivity,
  isStreamingVisible,
  readNormalizedLastReply,
} from "@/providers/chatgpt/page/wait-for-reply.ts";

type IsTransientAssistantStringDetails = {
  text: string;
};

function isTransientAssistantString(details: IsTransientAssistantStringDetails): boolean {
  const normalized = details.text.trim().toLowerCase();

  return (
    normalized === "thinking" ||
    normalized.endsWith(" thinking") ||
    normalized.endsWith(" thinking...") ||
    /^thinking[.\s]*$/.test(normalized) ||
    /^thought for\b/.test(normalized) ||
    normalized.startsWith("thought for ")
  );
}

export function isTurnSettled(status: TurnSettledStatus): boolean {
  const isStreaming = status.streaming;
  if (isStreaming) return false;

  const hasPendingAssets = status.pendingAssetCount > 0;
  if (hasPendingAssets) return false;

  const targetImageCount = Math.max(status.expectImages, status.expectedImageMarkerCount);

  const isAwaitingImages = targetImageCount > 0 || status.sawImageActivity || status.assetCount > 0;

  // Image tiles keep resetting the quiet timer, so a multi-image turn never settles between them.
  const isImageSettling =
    isAwaitingImages && status.millisecondsSinceImageActivity < ASSET_SETTLE_QUIET_MILLISECONDS;
  if (isImageSettling) return false;

  // Fewer tiles than requested or announced: keep waiting unless generation has stalled.
  const hasPendingImages = targetImageCount > 0 && status.loadedAssetCount < targetImageCount;
  if (hasPendingImages) {
    return status.stableForMilliseconds >= IMAGE_STALL_QUIET_MILLISECONDS;
  }

  const requiredQuietMilliseconds = isAwaitingImages
    ? ASSET_SETTLE_QUIET_MILLISECONDS
    : SETTLE_QUIET_MILLISECONDS;

  const isNotQuietEnough = status.stableForMilliseconds < requiredQuietMilliseconds;
  if (isNotQuietEnough) return false;

  const hasLoadedAssets = status.loadedAssetCount > 0;
  if (hasLoadedAssets) return true;

  const hasTargetImages = targetImageCount > 0;
  if (hasTargetImages) return false;

  return status.hasText && !status.isTransientText;
}

type TurnSettledStatus = {
  hasText: boolean;
  isTransientText: boolean;
  assetCount: number;
  loadedAssetCount: number;
  pendingAssetCount: number;
  expectedImageMarkerCount: number;
  streaming: boolean;
  stableForMilliseconds: number;
  expectImages: number;
  sawImageActivity: boolean;
  millisecondsSinceImageActivity: number;
};

type ReadTurnSnapshotDetails = {
  page: Page;
};

type TurnSnapshot = {
  text: string;
  streaming: boolean;
  assetCount: number;
  loadedAssetCount: number;
  pendingAssetCount: number;
  expectedImageMarkerCount: number;
};

export function countExpectedImageMarkers(string: string): number {
  const markers = string.match(/\[image-\d+\]/g);

  const isMarkersMissing = markers == null;
  if (isMarkersMissing) return 0;

  return markers.length;
}

export function turnSnapshotChanged(previous: TurnSnapshot, next: TurnSnapshot): boolean {
  return (
    previous.text !== next.text ||
    previous.assetCount !== next.assetCount ||
    previous.loadedAssetCount !== next.loadedAssetCount ||
    previous.pendingAssetCount !== next.pendingAssetCount ||
    previous.expectedImageMarkerCount !== next.expectedImageMarkerCount
  );
}

type LastAssistantTurnStatus = {
  text: string;
  assetCount: number;
  loadedAssetCount: number;
  pendingAssetCount: number;
  expectedImageMarkerCount: number;
};

export async function readTurnSnapshot(details: ReadTurnSnapshotDetails): Promise<TurnSnapshot> {
  let turnStatus: LastAssistantTurnStatus;
  try {
    turnStatus = await details.page.evaluate<LastAssistantTurnStatus>(
      LAST_ASSISTANT_TURN_STATUS_ORIGIN,
    );
  } catch {
    // The page may be navigating; read it as an empty turn and let the next poll retry.
    turnStatus = {
      text: "",
      assetCount: 0,
      loadedAssetCount: 0,
      pendingAssetCount: 0,
      expectedImageMarkerCount: 0,
    };
  }
  const streaming = await isStreamingVisible({ page: details.page });
  const string = cleanDisplayString({
    value: turnStatus.text || (await readNormalizedLastReply({ page: details.page })),
  });
  const markerCountInString = countExpectedImageMarkers(string);
  const expectedImageMarkerCount = Math.max(
    turnStatus.expectedImageMarkerCount,
    markerCountInString,
  );

  return {
    text: string,
    streaming,
    assetCount: turnStatus.assetCount,
    loadedAssetCount: turnStatus.loadedAssetCount,
    pendingAssetCount: turnStatus.pendingAssetCount,
    expectedImageMarkerCount,
  };
}

type TurnSnapshotSettledDetails = {
  snapshot: TurnSnapshot;
  stableForMilliseconds: number;
  expectImages: number;
  millisecondsSinceImageActivity: number;
  sawImageActivity: boolean;
};

export function turnSnapshotSettled(details: TurnSnapshotSettledDetails): boolean {
  const isSnapshotTransient = isTransientAssistantString({ text: details.snapshot.text });

  return isTurnSettled({
    hasText: !!details.snapshot.text,
    isTransientText: isSnapshotTransient,
    assetCount: details.snapshot.assetCount,
    loadedAssetCount: details.snapshot.loadedAssetCount,
    pendingAssetCount: details.snapshot.pendingAssetCount,
    expectedImageMarkerCount: details.snapshot.expectedImageMarkerCount,
    streaming: details.snapshot.streaming,
    stableForMilliseconds: details.stableForMilliseconds,
    expectImages: details.expectImages,
    millisecondsSinceImageActivity: details.millisecondsSinceImageActivity,
    sawImageActivity: details.sawImageActivity,
  });
}

export type WaitForLastAssistantStringStableDetails = {
  page: Page;
  timeout: number;
  expectImages: number;
  imageActivity: ImageNetworkActivity;
};
