import type { Page } from "playwright";
import { collectModelsFromItems, closeModelMenu } from "./collect-models-from-items.ts";
import { modelMenuItems } from "./model-menu-items.ts";
import { openModelMenu } from "./open-model-menu.ts";

/** Read available models from ChatGPT's model menu. */
export async function listAvailableModels(page: Page) {
  await openModelMenu({ page });
  const items = await modelMenuItems(page);
  const models = await collectModelsFromItems({ items });
  await closeModelMenu({ page });
  return models;
}
