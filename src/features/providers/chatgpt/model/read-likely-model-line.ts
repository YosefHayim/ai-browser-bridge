import { isLikelyModelLabel } from "./is-likely-model-label.ts";

/** Context for {@link readLikelyModelLine}. */
export interface ReadLikelyModelLineContext {
  /** Normalized trigger button text. */
  text: string;
}

/** Return the first line in trigger text that looks like a model label. */
export function readLikelyModelLine(ctx: ReadLikelyModelLineContext): string | null {
  return ctx.text.split("\n").find((part) => isLikelyModelLabel(part)) ?? null;
}
