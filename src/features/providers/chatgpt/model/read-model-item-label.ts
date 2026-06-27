import type { Locator } from "playwright";
import { MODEL_LABELS } from "./model-labels.config.ts";
import { normalizeDisplayText } from "../dom/normalize-display-text.ts";

/** Context for {@link readModelItemLabel}. */
export interface ReadModelItemLabelContext {
  /** Model menu item locator. */
  item: Locator;
}

/** Read the human-readable label for a model menu item. */
export async function readModelItemLabel(ctx: ReadModelItemLabelContext): Promise<string> {
  const testId = await ctx.item.getAttribute("data-testid").catch(() => null);
  if (testId?.startsWith("model-switcher-")) {
    const key = testId.replace("model-switcher-", "");
    if (MODEL_LABELS[key]) return MODEL_LABELS[key];
  }
  return normalizeDisplayText({ value: await ctx.item.innerText().catch(() => "") });
}
