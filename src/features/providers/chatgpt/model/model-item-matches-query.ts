import type { Locator } from "playwright";
import { normalizeModelQuery } from "../dom/normalize-model-query.ts";
import { isLikelyModelLabel } from "./is-likely-model-label.ts";
import { readModelItemId } from "./read-model-item-id.ts";
import { readModelItemLabel } from "./read-model-item-label.ts";

/** Context for {@link modelItemMatchesQuery}. */
export interface ModelItemMatchesQueryContext {
  /** Model menu item locator. */
  item: Locator;
  /** Normalized model search query. */
  normalizedQuery: string;
}

/** Result of matching a model menu item against a query. */
export interface ModelItemMatchResult {
  /** Whether the item exactly or partially matches the query. */
  matched: boolean;
  /** Locator to use as a fuzzy fallback when no exact match exists. */
  fallback: Locator | null;
}

/** Context for {@link buildModelItemMatchResult}. */
export interface BuildModelItemMatchResultContext {
  /** Model menu item locator. */
  item: Locator;
  /** Human-readable model label. */
  label: string;
  /** Normalized model search query. */
  normalizedQuery: string;
  /** Searchable normalized label/id string. */
  searchable: string;
}

/** Build a match result from label and searchable text. */
export function buildModelItemMatchResult(ctx: BuildModelItemMatchResultContext): ModelItemMatchResult {
  if (ctx.searchable === ctx.normalizedQuery || ctx.searchable.includes(ctx.normalizedQuery)) {
    return { matched: true, fallback: null };
  }
  const fallback = ctx.normalizedQuery.includes(normalizeModelQuery({ value: ctx.label })) ? ctx.item : null;
  return { matched: false, fallback };
}

/** Test whether a menu item matches a normalized model query. */
export async function modelItemMatchesQuery(ctx: ModelItemMatchesQueryContext): Promise<ModelItemMatchResult> {
  const label = await readModelItemLabel({ item: ctx.item });
  const id = await readModelItemId({ item: ctx.item });
  const searchable = normalizeModelQuery({ value: `${label} ${id}` });
  if (!label || !isLikelyModelLabel(label)) return { matched: false, fallback: null };
  return buildModelItemMatchResult({ item: ctx.item, label, normalizedQuery: ctx.normalizedQuery, searchable });
}
