import { MAX_STALL_RELOADS, RENDER_STALL_RELOAD_MS } from "@/config";
import type { Page } from "playwright";

/** Options for {@link createStallReloadWatchdog}. */
export interface StallReloadWatchdogOptions {
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
}

/** A stall watchdog: poke it with progress, ask it to reload when a render goes quiet. */
export interface StallReloadWatchdog {
  /** Record that the render made progress, resetting the stall clock. */
  noteProgress(): void;
  /** Reload the tab when the render has been stalled past the threshold and reloads remain. */
  maybeReload(page: Page): Promise<boolean>;
}

/**
 * Create a stall watchdog that reloads a provider tab when a render stops making progress.
 *
 * The wait loop calls {@link StallReloadWatchdog.noteProgress} whenever it observes change
 * (new text, a new/pending image, image-network activity) and {@link StallReloadWatchdog.maybeReload}
 * on each idle poll. A reload fires only after `stallMs` of no progress and only while reloads
 * remain, so a genuinely-streaming long render is never interrupted, while a turn stuck against
 * a stale DOM is re-synced with server truth (finished output renders, or the error shows).
 *
 * @param options - Threshold, cap, clock, and post-reload hooks; all optional.
 * @returns A watchdog handle bound to the resolved thresholds.
 * @example
 * ```ts
 * const watchdog = createStallReloadWatchdog({ waitAfterReload: (p) => p.waitForSelector("#composer") });
 * // ...each poll: watchdog.noteProgress() on change, else await watchdog.maybeReload(page)
 * ```
 */
export const createStallReloadWatchdog = (
  options: StallReloadWatchdogOptions = {},
): StallReloadWatchdog => {
  const stallMs = options.stallMs ?? RENDER_STALL_RELOAD_MS;
  const maxReloads = options.maxReloads ?? MAX_STALL_RELOADS;
  const now = options.now ?? Date.now;
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
      if (options.waitAfterReload) await options.waitAfterReload(page).catch(() => {});
      reloadsUsed += 1;
      lastProgressAt = now();
      options.onReload?.(reloadsUsed);
      return true;
    },
  };
};
