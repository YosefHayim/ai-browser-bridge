import { SELECTORS } from "../selectors.config.ts";

/** Context for {@link loadLastUserBlock}. */
export interface LoadLastUserBlockContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: import("playwright").Page;
}

/** Load the last user message block or throw when none exist. */
export async function loadLastUserBlock(ctx: LoadLastUserBlockContext) {
  const blocks = await ctx.page.locator(SELECTORS.userBlock).all();
  if (blocks.length === 0) throw new Error("No user message found to rewind.");
  return blocks[blocks.length - 1];
}
