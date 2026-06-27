import type { Page } from "playwright";
import { captureLastResponse, countAssistantResponses } from "./capture-response.ts";
import { SELECTORS } from "./selectors.config.ts";

/** Parsed timeout and baseline fields for Gemini response waits. */
export interface ParsedWaitOptions {
  timeout: number;
  previousAssistantCount?: number;
  previousLastAssistantText?: string;
}

export function parseWaitOptions(options: number | {
  timeout?: number;
  previousAssistantCount?: number;
  previousLastAssistantText?: string;
}): ParsedWaitOptions {
  if (typeof options === "number") return { timeout: options };
  return {
    timeout: options.timeout ?? 300_000,
    previousAssistantCount: options.previousAssistantCount,
    previousLastAssistantText: normalizeDisplayText(options.previousLastAssistantText ?? ""),
  };
}

export function normalizeDisplayText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

export function remainingTimeout(startedAt: number, timeout: number): number {
  return Math.max(1_000, timeout - (Date.now() - startedAt));
}

export function isTransientAssistantText(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return normalized === "thinking"
    || normalized.endsWith(" thinking")
    || normalized.endsWith(" thinking...")
    || /^thinking[.\s]*$/.test(normalized);
}

export async function waitForResponseAfterBaseline(page: Page, options: ParsedWaitOptions): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < options.timeout) {
    if (await baselineAdvanced({ page, options })) return;
    await page.waitForTimeout(250);
  }
  throw new Error("Timed out waiting for Gemini to start a new response.");
}

async function baselineAdvanced(input: { page: Page; options: ParsedWaitOptions }): Promise<boolean> {
  if (await hasStreamingIndicator(input.page)) return true;
  if (await assistantCountAdvanced(input)) return true;
  return lastAssistantTextAdvanced(input);
}

async function hasStreamingIndicator(page: Page): Promise<boolean> {
  return page.locator(SELECTORS.streamingIndicator).first().isVisible().catch(() => false);
}

async function assistantCountAdvanced(input: { page: Page; options: ParsedWaitOptions }): Promise<boolean> {
  if (input.options.previousAssistantCount === undefined) return false;
  const count = await countAssistantResponses(input.page);
  return count > input.options.previousAssistantCount;
}

async function lastAssistantTextAdvanced(input: { page: Page; options: ParsedWaitOptions }): Promise<boolean> {
  const lastText = normalizeDisplayText(await captureLastResponse(input.page).catch(() => ""));
  return !!input.options.previousLastAssistantText && !!lastText && lastText !== input.options.previousLastAssistantText;
}
