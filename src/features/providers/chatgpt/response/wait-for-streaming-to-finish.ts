import type { Page } from "playwright";
import { SELECTORS } from "../selectors.config.ts";
import { normalizeDisplayText } from "../dom/normalize-display-text.ts";
import { remainingTimeout } from "./remaining-timeout.ts";
import type { ResponseWaitOptions } from "./response-wait-options.ts";
import { waitForLastAssistantTextStable } from "./wait-for-last-assistant-text-stable.ts";
import { waitForResponseAfterBaseline } from "./wait-for-response-after-baseline.ts";

/** Context for {@link waitForStreamingToFinish}. */
export interface WaitForStreamingToFinishContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
  /** Timestamp when the wait started. */
  startedAt: number;
  /** Total timeout budget in milliseconds. */
  timeout: number;
}

/** Wait for the streaming indicator to appear then disappear. */
export async function waitForStreamingToFinish(ctx: WaitForStreamingToFinishContext): Promise<void> {
  try {
    await ctx.page.locator(SELECTORS.streamingIndicator).waitFor({ state: "visible", timeout: 10_000 });
    await ctx.page.locator(SELECTORS.streamingIndicator).waitFor({
      state: "hidden",
      timeout: remainingTimeout({ startedAt: ctx.startedAt, timeout: ctx.timeout }),
    });
  } catch {
    // Response might already be complete
  }
}

/** Parse {@link waitForResponse} options from a number or options object. */
export function parseResponseWaitOptions(options: number | ResponseWaitOptions): {
  timeout: number;
  previousAssistantCount?: number;
  previousLastAssistantText?: string;
} {
  if (typeof options === "number") {
    return { timeout: options };
  }
  return {
    timeout: options.timeout ?? 300_000,
    previousAssistantCount: options.previousAssistantCount,
    previousLastAssistantText: normalizeDisplayText({ value: options.previousLastAssistantText ?? "" }),
  };
}
