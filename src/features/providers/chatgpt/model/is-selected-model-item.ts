import type { Locator } from "playwright";

/** Context for {@link isSelectedModelItem}. */
export interface IsSelectedModelItemContext {
  /** Model menu item locator. */
  item: Locator;
}

/** True when the menu item represents the currently selected model. */
export async function isSelectedModelItem(ctx: IsSelectedModelItemContext): Promise<boolean> {
  const ariaChecked = await ctx.item.getAttribute("aria-checked").catch(() => null);
  if (ariaChecked === "true") return true;
  const dataState = await ctx.item.getAttribute("data-state").catch(() => null);
  return dataState === "checked";
}
