import type { Page } from "playwright";
import { openModelMenu } from "./open-model-menu.ts";
import { readCheckedModelFromOpenMenu } from "./read-checked-model-from-open-menu.ts";

/** Context for {@link detectCheckedModelFromMenuOnce}. */
export interface DetectCheckedModelFromMenuOnceContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/** Try once to read the checked model from the model menu. */
export async function detectCheckedModelFromMenuOnce(ctx: DetectCheckedModelFromMenuOnceContext): Promise<string | null> {
  try {
    await openModelMenu({ page: ctx.page });
    const checkedModel = await readCheckedModelFromOpenMenu({ page: ctx.page });
    await ctx.page.keyboard.press("Escape").catch(() => {});
    return checkedModel;
  } catch {
    await ctx.page.keyboard.press("Escape").catch(() => {});
    return null;
  }
}

/** Context for {@link detectCheckedModelFromMenu}. */
export interface DetectCheckedModelFromMenuContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/** Retry opening the model menu until a checked model label is found. */
export async function detectCheckedModelFromMenu(ctx: DetectCheckedModelFromMenuContext): Promise<string | null> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const checkedModel = await detectCheckedModelFromMenuOnce({ page: ctx.page });
    if (checkedModel) return checkedModel;
    await ctx.page.waitForTimeout(750);
  }
  return null;
}
