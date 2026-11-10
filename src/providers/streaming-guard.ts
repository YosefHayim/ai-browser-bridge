import type { Page } from "playwright";

const IDLE_POLL_MS = 300;

// Require two clear polls so a brief flicker between stream phases never reads as idle.
const IDLE_CONFIRMATIONS = 2;

const DEFAULT_IDLE_TIMEOUT_MS = 300_000;

export const isReplyGenerating = async (page: Page, stopSelector: string): Promise<boolean> => {
  const isStopSelectorEmpty = stopSelector.length === 0;
  if (isStopSelectorEmpty) return false;

  try {
    return await page.locator(stopSelector).first().isVisible();
  } catch {
    // Playwright can throw when the page navigates mid-query.
    return false;
  }
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

    try {
      await page.waitForTimeout(IDLE_POLL_MS);
    } catch {
      // Page may close mid-wait; keep polling until the budget expires.
    }
  }
  throw new Error("Timed out waiting for the current response to finish before sending.");
};
