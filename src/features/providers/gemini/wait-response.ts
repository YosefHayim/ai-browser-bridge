import type { Page } from "playwright";
import { captureLastResponse, countAssistantResponses } from "./capture-response.ts";
import { SELECTORS } from "./selectors.config.ts";
import {
  isTransientAssistantText,
  normalizeDisplayText,
  parseWaitOptions,
  remainingTimeout,
  type ParsedWaitOptions,
  waitForResponseAfterBaseline,
} from "./wait-response.helpers.ts";

/** Options for waiting on a new Gemini response after a baseline snapshot. */
export interface ResponseWaitOptions {
  timeout?: number;
  previousAssistantCount?: number;
  previousLastAssistantText?: string;
}

/** Quiet window a plain text turn must hold before it counts as settled. */
const SETTLE_QUIET_MS = 1_500;

/**
 * Decide whether the current assistant turn has finished producing output.
 * Pure helper so completion policy is unit-testable without a browser.
 */
export function isTurnSettled(state: {
  hasText: boolean;
  isTransientText: boolean;
  streaming: boolean;
  stableForMs: number;
}): boolean {
  if (state.streaming) return false;
  if (state.stableForMs < SETTLE_QUIET_MS) return false;
  return state.hasText && !state.isTransientText;
}

/** Wait for Gemini to finish streaming its response. */
export async function waitForResponse(
  page: Page,
  options: number | ResponseWaitOptions = {},
): Promise<void> {
  const parsed = parseWaitOptions(options);
  const startedAt = Date.now();
  await waitForInitialResponse({ page, parsed });
  await waitForStreamingEnd({ page, startedAt, timeout: parsed.timeout });
  await waitForLastAssistantTextStable({ page, timeout: remainingTimeout(startedAt, parsed.timeout) });
}

async function waitForInitialResponse(input: { page: Page; parsed: ParsedWaitOptions }): Promise<void> {
  if (input.parsed.previousAssistantCount !== undefined || input.parsed.previousLastAssistantText) {
    await waitForResponseAfterBaseline(input.page, input.parsed);
    return;
  }
  await input.page.waitForSelector(SELECTORS.responseBlock, { timeout: input.parsed.timeout });
}

async function waitForStreamingEnd(input: { page: Page; startedAt: number; timeout: number }): Promise<void> {
  try {
    const indicator = input.page.locator(SELECTORS.streamingIndicator).first();
    await indicator.waitFor({ state: "visible", timeout: 10_000 });
    await indicator.waitFor({ state: "hidden", timeout: remainingTimeout(input.startedAt, input.timeout) });
  } catch {
    // Response might already be complete
  }
}

async function waitForLastAssistantTextStable(input: { page: Page; timeout: number }): Promise<void> {
  const startedAt = Date.now();
  let lastText = "";
  let stableSince = Date.now();
  while (Date.now() - startedAt < input.timeout) {
    const snapshot = await readStabilitySnapshot(input.page);
    if (snapshot.text !== lastText) {
      lastText = snapshot.text;
      stableSince = Date.now();
    }
    if (isTurnSettled({
      hasText: !!snapshot.text,
      isTransientText: isTransientAssistantText(snapshot.text),
      streaming: snapshot.streaming,
      stableForMs: Date.now() - stableSince,
    })) return;
    await input.page.waitForTimeout(500);
  }
  throw new Error("Timed out waiting for Gemini response to settle.");
}

async function readStabilitySnapshot(page: Page): Promise<{ text: string; streaming: boolean }> {
  const text = normalizeDisplayText(await captureLastResponse(page).catch(() => ""));
  const streaming = await page.locator(SELECTORS.streamingIndicator).first().isVisible().catch(() => false);
  return { text, streaming };
}
