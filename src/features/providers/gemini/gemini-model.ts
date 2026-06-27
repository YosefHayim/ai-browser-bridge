import type { Locator, Page } from "playwright";
import type { ModelOption } from "../../domain/types.ts";
import { collectMenuModels, firstVisible, readModelFromTrigger } from "./gemini-model.picker.ts";
import { SELECTORS } from "./selectors.config.ts";

export { isLikelyModelLabel } from "./gemini-model.helpers.ts";

/** Detect the currently selected Gemini model from the page DOM. */
export async function detectCurrentModel(page: Page): Promise<string> {
  try {
    const trigger = await firstVisible({ page, selector: SELECTORS.modelTrigger });
    if (!trigger) return "Gemini";
    return await readModelFromTrigger(trigger);
  } catch {
    return "Gemini";
  }
}

/** List models exposed by Gemini's model picker when it can be opened. */
export async function listAvailableModels(page: Page): Promise<ModelOption[]> {
  const trigger = await firstVisible({ page, selector: SELECTORS.modelTrigger });
  if (!trigger) return [];
  return collectModelsFromOpenMenu({ page, trigger });
}

async function collectModelsFromOpenMenu(input: { page: Page; trigger: Locator }): Promise<ModelOption[]> {
  await input.trigger.click().catch(() => {});
  await input.page.waitForSelector(SELECTORS.openMenu, { timeout: 3_000 }).catch(() => {});
  const models = await collectMenuModels(input.page);
  await input.page.keyboard.press("Escape").catch(() => {});
  return models;
}

/** Switch Gemini to a model exposed by the browser model picker. */
export async function selectModel(page: Page, query: string): Promise<string> {
  const match = await findModelMatch({ page, query });
  await clickModelMenuItem({ page, label: match.label });
  return match.label;
}

async function clickModelMenuItem(input: { page: Page; label: string }): Promise<void> {
  const trigger = await firstVisible({ page: input.page, selector: SELECTORS.modelTrigger });
  if (!trigger) throw new Error("Gemini model picker is not available.");
  await trigger.click();
  await selectMenuModelItem(input);
}

async function selectMenuModelItem(input: { page: Page; label: string }): Promise<void> {
  await input.page.waitForSelector(SELECTORS.openMenu, { timeout: 3_000 });
  await input.page.locator(`${SELECTORS.openMenu} [role="menuitem"], ${SELECTORS.openMenu} [role="option"]`)
    .filter({ hasText: input.label })
    .first()
    .click();
  await input.page.keyboard.press("Escape").catch(() => {});
}

async function findModelMatch(input: { page: Page; query: string }): Promise<ModelOption> {
  const models = await listAvailableModels(input.page);
  const normalizedQuery = input.query.trim().toLowerCase();
  const match = models.find((model) =>
    model.label.toLowerCase().includes(normalizedQuery)
    || model.id.includes(normalizedQuery.replace(/\s+/g, "-")),
  );
  if (!match) throw new Error(`Model not found in Gemini picker: ${input.query}`);
  return match;
}
