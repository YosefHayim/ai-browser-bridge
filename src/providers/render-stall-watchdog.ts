import type { Page } from "playwright";
import { MAX_STALL_RELOADS, RENDER_STALL_RELOAD_MS } from "@/config";
import { logUnlessElementMissing, probeOrFallback } from "./browser-provider.ts";

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
  const stallMs = settings.stallMs ?? RENDER_STALL_RELOAD_MS;
  const maxReloads = settings.maxReloads ?? MAX_STALL_RELOADS;
  const now = settings.now ?? Date.now;
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

      // A reload can race with an in-flight navigation; the post-reload wait still runs.
      await probeOrFallback(null, () => page.reload({ waitUntil: "domcontentloaded" }));

      const waitAfterReload = settings.waitAfterReload;

      const hasSettingsWaitAfterReload = waitAfterReload != null;
      if (hasSettingsWaitAfterReload) {
        try {
          await waitAfterReload(page);
        } catch (error) {
          // The post-reload wait is best-effort, so the stall clock resets either way.
          logUnlessElementMissing(error);
        }
      }

      reloadsUsed += 1;
      lastProgressAt = now();

      const onReload = settings.onReload;

      const hasSettingsOnReload = onReload != null;
      if (hasSettingsOnReload) {
        onReload(reloadsUsed);
      }

      return true;
    },
  };
};
