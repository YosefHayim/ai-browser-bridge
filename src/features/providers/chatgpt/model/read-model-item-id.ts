import type { Locator } from "playwright";
import { normalizeModelQuery } from "../dom/normalize-model-query.ts";
import { readModelItemLabel } from "./read-model-item-label.ts";

/** Context for {@link readModelItemId}. */
export interface ReadModelItemIdContext {
  /** Model menu item locator. */
  item: Locator;
}

/** Derive a stable model id from a menu item's test id or label. */
export async function readModelItemId(ctx: ReadModelItemIdContext): Promise<string> {
  const testId = await ctx.item.getAttribute("data-testid").catch(() => null);
  if (testId?.startsWith("model-switcher-")) return testId.replace("model-switcher-", "");
  const label = await readModelItemLabel({ item: ctx.item });
  return normalizeModelQuery({ value: label }).replace(/\s+/g, "-");
}
