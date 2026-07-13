import type { Page } from "playwright";

/** Milliseconds between polls while watching a provider's stop/streaming control. */
const IDLE_POLL_MS = 300;

/** Consecutive clear polls required before a conversation counts as idle, so a brief
 *  flicker between phases (thinking → answering, text → image) never reads as finished. */
const IDLE_CONFIRMATIONS = 2;

/** Default ceiling for waiting out an in-flight response before giving up. */
const DEFAULT_IDLE_TIMEOUT_MS = 300_000;

/**
 * Report whether the provider is still generating a response, detected by the visible
 * stop/streaming control that web chats swap in for the send button while a reply streams.
 *
 * @param page - Playwright page for the provider tab.
 * @param stopSelector - Selector for the stop/streaming control; an empty string means the provider exposes none.
 * @returns True while a response is streaming, false when idle or undetectable.
 * @example
 * ```ts
 * if (await isResponseGenerating(page, 'button[data-testid="stop-button"]')) return;
 * ```
 */
export const isResponseGenerating = async (page: Page, stopSelector: string): Promise<boolean> => {
  if (!stopSelector) return false;
  return page
    .locator(stopSelector)
    .first()
    .isVisible()
    .catch(() => false);
};

/**
 * Wait until the conversation is idle before typing or sending, so the bridge never spams
 * a busy chat and never trips an interrupt loop by acting on the stop button mid-stream.
 * Resolves as soon as the stop control stays absent across a couple of polls; throws only
 * when a response never finishes within the budget.
 *
 * @param page - Playwright page for the provider tab.
 * @param stopSelector - Selector for the stop/streaming control; an empty string resolves immediately.
 * @param timeoutMs - Maximum time to wait for an in-flight response to finish.
 * @returns Resolves once no response is generating.
 * @example
 * ```ts
 * await waitForResponseIdle(page, 'button[aria-label*="Stop"]');
 * ```
 */
export const waitForResponseIdle = async (
  page: Page,
  stopSelector: string,
  timeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
): Promise<void> => {
  if (!stopSelector) return;
  const startedAt = Date.now();
  let clearStreak = 0;
  while (Date.now() - startedAt < timeoutMs) {
    if (await isResponseGenerating(page, stopSelector)) {
      clearStreak = 0;
    } else {
      clearStreak += 1;
      if (clearStreak >= IDLE_CONFIRMATIONS) return;
    }
    await page.waitForTimeout(IDLE_POLL_MS).catch(() => {});
  }
  throw new Error("Timed out waiting for the current response to finish before sending.");
};
