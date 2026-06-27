/** Context for {@link normalizeDisplayText}. */
export interface NormalizeDisplayTextContext {
  /** Raw text pulled from the ChatGPT DOM. */
  value: string;
}

/** Collapse whitespace and strip "(current|selected)" markers from UI labels. */
export function normalizeDisplayText(ctx: NormalizeDisplayTextContext): string {
  return ctx.value
    .replace(/\s+/g, " ")
    .replace(/\b(current|selected)\b/gi, "")
    .trim();
}
