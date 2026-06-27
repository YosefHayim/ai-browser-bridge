import type { Page } from "playwright";
import { isSelectedModelItem } from "./is-selected-model-item.ts";
import { modelMenuItems } from "./model-menu-items.ts";
import { readModelItemLabel } from "./read-model-item-label.ts";

/** Context for {@link readCheckedModelFromOpenMenu}. */
export interface ReadCheckedModelFromOpenMenuContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/** Read the label of the checked model item from an already-open menu. */
export async function readCheckedModelFromOpenMenu(ctx: ReadCheckedModelFromOpenMenuContext): Promise<string | null> {
  const items = await modelMenuItems(ctx.page);
  for (const item of items) {
    if (await isSelectedModelItem({ item })) {
      const label = await readModelItemLabel({ item });
      if (label) return label;
    }
  }
  return null;
}
