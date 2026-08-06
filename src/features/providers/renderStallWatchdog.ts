import type { Page } from "playwright";
import { MAX_STALL_RELOADS, RENDER_STALL_RELOAD_MS } from "@/config";

/** Threshold, cap, clock, and post-reload hooks for a stall reload watchdog. */
export type StallReloadWatchdogOptions = {
  /** Milliseconds of no progress before a reload fires (default {@link RENDER_STALL_RELOAD_MS}). */
  stallMs?: number;
  /** Maximum reloads before giving up and letting the wait time out (default {@link MAX_STALL_RELOADS}). */
  maxReloads?: number;
  /** Clock injection point so the reload policy is testable without a real timer. */
  now?: () => number;
  /** Awaited after a reload so the caller can re-wait for its composer/DOM before re-reading. */
  waitAfterReload?: (page: Page) => Promise<void>;
  /** Notified after each reload with the running reload count (1-based). */
  onReload?: (reloadCount: number) => void;
};

/** A stall watchdog: poke it with progress, ask it to reload when a render goes quiet. */
export interface StallReloadWatchdog {
  /** Record that the render made progress, resetting the stall clock. */
  noteProgress(): void;
  /** Reload the tab when the render has been stalled past the threshold and reloads remain. */
  maybeReload(page: Page): Promise<boolean>;
}

/**
 * Stall watchdog that reloads a provider tab when a render stops making progress.
 *
 * The wait loop calls `noteProgress` whenever it observes change (new text, a new/pending
 * image, image-network activity) and `maybeReload` on each idle poll. A reload fires only
 * after `stallMs` of no progress and only while reloads remain, so a genuinely-streaming
 * long render is never interrupted, while a turn stuck against a stale DOM is re-synced
 * with server truth.
 */
export const stallReloadWatchdogFor = (
  watchdogOptions: StallReloadWatchdogOptions = {},
): StallReloadWatchdog => {
  const stallMs =
    watchdogOptions.stallMs === undefined ? RENDER_STALL_RELOAD_MS : watchdogOptions.stallMs;
  const maxReloads =
    watchdogOptions.maxReloads === undefined ? MAX_STALL_RELOADS : watchdogOptions.maxReloads;
  const now = watchdogOptions.now === undefined ? Date.now : watchdogOptions.now;
  let lastProgressAt = now();
  let reloadsUsed = 0;
  return {
    noteProgress() {
      lastProgressAt = now();
    },
    async maybeReload(page: Page): Promise<boolean> {
      if (reloadsUsed >= maxReloads) return false;
      if (now() - lastProgressAt < stallMs) return false;
      await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
      if (watchdogOptions.waitAfterReload) {
        await watchdogOptions.waitAfterReload(page).catch(() => {});
      }
      reloadsUsed += 1;
      lastProgressAt = now();
      watchdogOptions.onReload?.(reloadsUsed);
      return true;
    },
  };
};
