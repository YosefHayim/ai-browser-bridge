import type { Page } from "playwright";
import { SELECTORS } from "../selectors.config.ts";
import { isStreamingVisible, readNormalizedLastResponse } from "./streaming-helpers.ts";

/** Context for {@link responseStartedAfterBaseline}. */
export interface ResponseStartedAfterBaselineContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
  /** Assistant block count before the prompt was sent. */
  previousAssistantCount?: number;
  /** Last assistant text before the prompt was sent. */
  previousLastAssistantText?: string;
}

/** True when a new assistant response has started relative to the baseline. */
export async function responseStartedAfterBaseline(ctx: ResponseStartedAfterBaselineContext): Promise<boolean> {
  if (await isStreamingVisible({ page: ctx.page })) return true;
  const count = await ctx.page.locator(SELECTORS.responseBlock).count();
  if (ctx.previousAssistantCount !== undefined && count > ctx.previousAssistantCount) return true;
  const lastText = await readNormalizedLastResponse({ page: ctx.page });
  return !!ctx.previousLastAssistantText && !!lastText && lastText !== ctx.previousLastAssistantText;
}
