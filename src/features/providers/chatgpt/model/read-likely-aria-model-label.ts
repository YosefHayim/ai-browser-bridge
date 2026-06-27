import type { Locator } from "playwright";
import { isLikelyModelLabel } from "./is-likely-model-label.ts";

/** Context for {@link readLikelyAriaModelLabel}. */
export interface ReadLikelyAriaModelLabelContext {
  /** Model switcher trigger locator. */
  trigger: Locator;
}

/** Read a model label from the trigger aria-label when it looks valid. */
export async function readLikelyAriaModelLabel(ctx: ReadLikelyAriaModelLabelContext): Promise<string | null> {
  const ariaLabel = await ctx.trigger.getAttribute("aria-label").catch(() => null);
  return ariaLabel && isLikelyModelLabel(ariaLabel) ? ariaLabel.trim() : null;
}
