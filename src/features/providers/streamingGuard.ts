import type { Page } from "playwright";

const IDLE_POLL_MS = 300;

// Require two clear polls so a brief flicker between stream phases never reads as idle.
const IDLE_CONFIRMATIONS = 2;

const DEFAULT_IDLE_TIMEOUT_MS = 300_000;

/** Whether the stop/streaming control is visible (empty selector means none). */
export const isResponseGenerating = async (page: Page, stopSelector: string): Promise<boolean> => {
  if (stopSelector.length === 0) return false;
  try {
    return await page.locator(stopSelector).first().isVisible();
  } catch {
    // Playwright can throw when the page navigates mid-query.
    return false;
  }
};

/**
 * Wait until the stop control stays absent across confirmation polls before acting.
 * An empty `stopSelector` resolves immediately.
 */
export const waitForResponseIdle = async (
  page: Page,
  stopSelector: string,
  timeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
): Promise<void> => {
  if (stopSelector.length === 0) return;
  const startedAt = Date.now();
  let clearStreak = 0;
  while (Date.now() - startedAt < timeoutMs) {
    if (await isResponseGenerating(page, stopSelector)) {
      clearStreak = 0;
    } else {
      clearStreak += 1;
      if (clearStreak >= IDLE_CONFIRMATIONS) return;
    }
    try {
      await page.waitForTimeout(IDLE_POLL_MS);
    } catch {
      // Page may close mid-wait; keep polling until the budget expires.
    }
  }
  throw new Error("Timed out waiting for the current response to finish before sending.");
};
