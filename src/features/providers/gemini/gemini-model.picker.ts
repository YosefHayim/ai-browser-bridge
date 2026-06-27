import type { Locator, Page } from "playwright";
import type { ModelOption } from "../../domain/types.ts";
import { isLikelyModelLabel, normalizeDisplayText } from "./gemini-model.helpers.ts";
import { SELECTORS } from "./selectors.config.ts";

export async function readModelFromTrigger(trigger: Locator): Promise<string> {
  const text = normalizeDisplayText(await trigger.innerText().catch(() => ""));
  const line = text.split("\n").find((part) => isLikelyModelLabel(part));
  if (line) return line;
  return readTriggerAriaLabel(trigger);
}

async function readTriggerAriaLabel(trigger: Locator): Promise<string> {
  const ariaLabel = await trigger.getAttribute("aria-label").catch(() => null);
  if (ariaLabel && isLikelyModelLabel(ariaLabel)) return ariaLabel.trim();
  return "Gemini";
}

export async function collectMenuModels(page: Page): Promise<ModelOption[]> {
  const items = page.locator(`${SELECTORS.openMenu} [role="menuitem"], ${SELECTORS.openMenu} [role="option"]`);
  const count = await items.count();
  const models: ModelOption[] = [];
  for (let i = 0; i < count; i += 1) {
    const model = await readMenuItemModel(items.nth(i));
    if (model) models.push(model);
  }
  return models;
}

async function readMenuItemModel(item: Locator): Promise<ModelOption | null> {
  const label = normalizeDisplayText(await item.innerText().catch(() => ""));
  if (!label || !isLikelyModelLabel(label)) return null;
  const selected = (await item.getAttribute("aria-checked").catch(() => null)) === "true"
    || (await item.getAttribute("aria-selected").catch(() => null)) === "true";
  return { id: label.toLowerCase().replace(/\s+/g, "-"), label, selected: !!selected };
}

export async function firstVisible(params: { page: Page; selector: string }): Promise<Locator | null> {
  const locator = params.page.locator(params.selector);
  const count = await locator.count();
  for (let i = 0; i < count; i += 1) {
    const candidate = locator.nth(i);
    if (await candidate.isVisible().catch(() => false)) return candidate;
  }
  return null;
}
