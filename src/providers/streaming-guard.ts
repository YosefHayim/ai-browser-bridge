import type { Page } from "playwright";
import { probeOrFallback } from "./browser-provider.ts";

const IDLE_POLL_MS = 300;

// Require two clear polls so a brief flicker between stream phases never reads as idle.
const IDLE_CONFIRMATIONS = 2;

const DEFAULT_IDLE_TIMEOUT_MS = 300_000;

export const isReplyGenerating = async (page: Page, stopSelector: string): Promise<boolean> => {
  const isStopSelectorEmpty = stopSelector.length === 0;
  if (isStopSelectorEmpty) return false;

  // Playwright can throw when the page navigates mid-query, so a failed probe means not generating.
  return probeOrFallback(false, () => page.locator(stopSelector).first().isVisible());
};

export const waitForReplyIdle = async (
  page: Page,
  stopSelector: string,
  timeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
): Promise<void> => {
  const isStopSelectorEmpty = stopSelector.length === 0;
  if (isStopSelectorEmpty) return;

  const startedAt = Date.now();
  let clearStreak = 0;
  while (Date.now() - startedAt < timeoutMs) {
    const isStillGenerating = await isReplyGenerating(page, stopSelector);
    if (isStillGenerating) {
      clearStreak = 0;
    } else {
      clearStreak += 1;

      const hasIdleConfirmations = clearStreak >= IDLE_CONFIRMATIONS;
      if (hasIdleConfirmations) return;
    }

    // A page that closes mid-wait keeps polling until the budget expires.
    await probeOrFallback(null, () => page.waitForTimeout(IDLE_POLL_MS));
  }
  throw new Error("Timed out waiting for the current response to finish before sending.");
};
