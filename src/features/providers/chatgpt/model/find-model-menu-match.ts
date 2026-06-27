import type { Page } from "playwright";
import type { Locator } from "playwright";
import { modelMenuItems } from "./model-menu-items.ts";
import { modelItemMatchesQuery } from "./model-item-matches-query.ts";

/** Context for {@link findModelMenuMatch}. */
export interface FindModelMenuMatchContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
  /** Normalized model search query. */
  normalizedQuery: string;
}

/** Find the first matching model menu item, tracking a fuzzy fallback. */
export async function findModelMenuMatch(ctx: FindModelMenuMatchContext): Promise<Locator | null> {
  const items = await modelMenuItems(ctx.page);
  let fallback: Locator | null = null;
  for (const item of items) {
    const result = await modelItemMatchesQuery({ item, normalizedQuery: ctx.normalizedQuery });
    if (result.matched) return item;
    if (!fallback && result.fallback) fallback = result.fallback;
  }
  return fallback;
}
