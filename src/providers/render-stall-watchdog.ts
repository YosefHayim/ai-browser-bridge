import type { Page } from "playwright";
import { MAX_STALL_RELOADS, RENDER_STALL_RELOAD_MS } from "@/config";

export type StallReloadWatchdogOptions = {
  stallMs?: number;
  maxReloads?: number;
  /** Clock injection so the reload policy is testable without a real timer. */
  now?: () => number;
  /** Re-wait for composer/DOM after a reload before the caller re-reads progress. */
  waitAfterReload?: (page: Page) => Promise<void>;
  /** Notified after each reload with the 1-based reload count. */
  onReload?: (reloadCount: number) => void;
};

export interface StallReloadWatchdog {
  noteProgress(): void;
  maybeReload(page: Page): Promise<boolean>;
}

/**
 * Reloads a provider tab when a render stops making progress.
 *
 * Wait loops call `noteProgress` on observed change and `maybeReload` on each idle
 * poll. A reload fires only after `stallMs` of no progress and only while reloads
 * remain, so a long streaming render is never interrupted while a stuck DOM is
 * re-synced with server truth.
 */
export const stallReloadWatchdogFor = (
  options: StallReloadWatchdogOptions = {},
): StallReloadWatchdog => {
  const stallMs = options.stallMs === undefined ? RENDER_STALL_RELOAD_MS : options.stallMs;
  const maxReloads = options.maxReloads === undefined ? MAX_STALL_RELOADS : options.maxReloads;
  const now = options.now === undefined ? Date.now : options.now;
  let lastProgressAt = now();
  let reloadsUsed = 0;
  return {
    noteProgress() {
      lastProgressAt = now();
    },
    async maybeReload(page: Page): Promise<boolean> {
      if (reloadsUsed >= maxReloads) return false;
      if (now() - lastProgressAt < stallMs) return false;
      try {
        await page.reload({ waitUntil: "domcontentloaded" });
      } catch {
        // Reload can race with an in-flight navigation; still run post-reload wait.
      }
      if (options.waitAfterReload !== undefined) {
        try {
          await options.waitAfterReload(page);
        } catch {
          // Post-reload wait is best-effort; continue so the stall clock resets.
        }
      }
      reloadsUsed += 1;
      lastProgressAt = now();
      if (options.onReload !== undefined) {
        options.onReload(reloadsUsed);
      }
      return true;
    },
  };
};
