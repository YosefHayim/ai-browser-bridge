import type { Page } from "playwright";
import type { Locator } from "playwright";
import type { ModelOption } from "../../../domain/types.ts";
import { parseModelMenuItem } from "./parse-model-menu-item.ts";

/** Context for {@link collectModelsFromItems}. */
export interface CollectModelsFromItemsContext {
  /** Model menu item locators to parse. */
  items: Locator[];
}

/** Parse menu items into a deduplicated model option list. */
export async function collectModelsFromItems(ctx: CollectModelsFromItemsContext): Promise<ModelOption[]> {
  const models: ModelOption[] = [];
  for (const item of ctx.items) {
    const option = await parseModelMenuItem({ item });
    if (option && !models.some((model) => model.id === option.id && model.label === option.label)) {
      models.push(option);
    }
  }
  return models;
}

/** Context for {@link closeModelMenu}. */
export interface CloseModelMenuContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/** Dismiss the open model menu with Escape. */
export async function closeModelMenu(ctx: CloseModelMenuContext): Promise<void> {
  await ctx.page.keyboard.press("Escape").catch(() => {});
}
