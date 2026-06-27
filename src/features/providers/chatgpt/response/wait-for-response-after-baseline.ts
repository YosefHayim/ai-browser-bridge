import type { Page } from "playwright";
import { responseStartedAfterBaseline } from "./response-started-after-baseline.ts";

/** Context for {@link waitForResponseAfterBaseline}. */
export interface WaitForResponseAfterBaselineContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
  /** Assistant block count before the prompt was sent. */
  previousAssistantCount?: number;
  /** Last assistant text before the prompt was sent. */
  previousLastAssistantText?: string;
  /** Maximum wait time in milliseconds. */
  timeout: number;
}

/** Wait until ChatGPT begins a new response relative to a pre-send baseline. */
export async function waitForResponseAfterBaseline(ctx: WaitForResponseAfterBaselineContext): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < ctx.timeout) {
    if (await responseStartedAfterBaseline(ctx)) return;
    await ctx.page.waitForTimeout(250);
  }
  throw new Error("Timed out waiting for ChatGPT to start a new response.");
}
