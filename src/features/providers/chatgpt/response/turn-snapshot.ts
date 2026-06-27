import type { Page } from "playwright";
import { SELECTORS } from "../selectors.config.ts";
import { isStreamingVisible, readNormalizedLastResponse } from "./streaming-helpers.ts";
import { isTransientAssistantText } from "./is-transient-assistant-text.ts";
import { isTurnSettled } from "./is-turn-settled.ts";

/** Context for {@link readTurnSnapshot}. */
export interface ReadTurnSnapshotContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/** Snapshot of the current assistant turn used for settle detection. */
export interface TurnSnapshot {
  /** Normalized last assistant response text. */
  text: string;
  /** Whether streaming indicator is visible. */
  streaming: boolean;
  /** Count of generated image assets in the DOM. */
  assetCount: number;
}

/** Read current assistant turn snapshot from the page. */
export async function readTurnSnapshot(ctx: ReadTurnSnapshotContext): Promise<TurnSnapshot> {
  const text = await readNormalizedLastResponse({ page: ctx.page });
  const streaming = await isStreamingVisible({ page: ctx.page });
  const assetCount = await ctx.page.locator(SELECTORS.generatedImage).count().catch(() => 0);
  return { text, streaming, assetCount };
}

/** Context for {@link turnSnapshotSettled}. */
export interface TurnSnapshotSettledContext {
  /** Turn snapshot to evaluate. */
  snapshot: TurnSnapshot;
  /** Milliseconds the snapshot has been unchanged. */
  stableForMs: number;
}

/** True when the snapshot satisfies {@link isTurnSettled}. */
export function turnSnapshotSettled(ctx: TurnSnapshotSettledContext): boolean {
  return isTurnSettled({
    hasText: !!ctx.snapshot.text,
    isTransientText: isTransientAssistantText({ text: ctx.snapshot.text }),
    assetCount: ctx.snapshot.assetCount,
    streaming: ctx.snapshot.streaming,
    stableForMs: ctx.stableForMs,
  });
}
