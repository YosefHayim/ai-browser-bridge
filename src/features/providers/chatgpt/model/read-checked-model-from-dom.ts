import type { Page } from "playwright";
import { readModelItemLabel } from "./read-model-item-label.ts";

/** Context for {@link readCheckedModelFromDom}. */
export interface ReadCheckedModelFromDomContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/** Read the checked model from aria-checked switcher items in the DOM. */
export async function readCheckedModelFromDom(ctx: ReadCheckedModelFromDomContext): Promise<string | null> {
  const checked = ctx.page.locator('[data-testid^="model-switcher-"][aria-checked="true"]').first();
  if (await checked.count() > 0) {
    return readModelItemLabel({ item: checked });
  }
  return null;
}
