/** Context for {@link normalizeModelQuery}. */
export interface NormalizeModelQueryContext {
  /** User-supplied or DOM-derived model label or id. */
  value: string;
}

/** Normalize a model query string for fuzzy matching against menu items. */
export function normalizeModelQuery(ctx: NormalizeModelQueryContext): string {
  return ctx.value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
