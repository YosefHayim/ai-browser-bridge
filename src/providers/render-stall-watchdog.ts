import type { Page } from "playwright";
import { MAX_STALL_RELOADS, RENDER_STALL_RELOAD_MS } from "@/config";

export type StallReloadWatchdogSettings = {
  stallMs?: number;
  maxReloads?: number;
  now?: () => number;
  waitAfterReload?: (page: Page) => Promise<void>;
  onReload?: (reloadCount: number) => void;
};

export interface StallReloadWatchdog {
  noteProgress(): void;
  reloadIfStalled(page: Page): Promise<boolean>;
}

export const createStallReloadWatchdog = (
  settings: StallReloadWatchdogSettings = {},
): StallReloadWatchdog => {
  const stallMs = settings.stallMs === undefined ? RENDER_STALL_RELOAD_MS : settings.stallMs;
  const maxReloads = settings.maxReloads === undefined ? MAX_STALL_RELOADS : settings.maxReloads;
  const now = settings.now === undefined ? Date.now : settings.now;
  let lastProgressAt = now();
  let reloadsUsed = 0;
  return {
    noteProgress() {
      lastProgressAt = now();
    },
    async reloadIfStalled(page: Page): Promise<boolean> {
      const isReloadsUsedAtLeastMaxReloads = reloadsUsed >= maxReloads;
      if (isReloadsUsedAtLeastMaxReloads) return false;

      const isWithinStallWindow = now() - lastProgressAt < stallMs;
      if (isWithinStallWindow) return false;

      try {
        await page.reload({ waitUntil: "domcontentloaded" });
      } catch {
        // Reload can race with an in-flight navigation; still run post-reload wait.
      }

      const hasSettingsWaitAfterReload = settings.waitAfterReload !== undefined;
      if (hasSettingsWaitAfterReload) {
        try {
          await settings.waitAfterReload(page);
        } catch {
          // Post-reload wait is best-effort; continue so the stall clock resets.
        }
      }

      reloadsUsed += 1;
      lastProgressAt = now();

      const hasSettingsOnReload = settings.onReload !== undefined;
      if (hasSettingsOnReload) {
        settings.onReload(reloadsUsed);
      }

      return true;
    },
  };
};
