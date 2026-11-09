import type { Locator, Page } from "playwright";
import type { ModelOption } from "../../connectors/connectorTypes.ts";
import { firstVisible, normalizeDisplayText, SELECTORS } from "./chatgptControls.ts";

type ClickModelAndDetectContext = {
  page: Page;
  item: Locator;
};

type FindModelMenuMatchContext = {
  page: Page;
  normalizedQuery: string;
};

type ModelItemMatchesQueryContext = {
  item: Locator;
  normalizedQuery: string;
};

type ModelItemMatchResult = {
  matched: boolean;
  fallback: Locator | null;
};

type ModelItemMatchInput = {
  item: Locator;
  label: string;
  normalizedQuery: string;
  searchable: string;
};

type SelectModelOrThrowContext = {
  page: Page;
  query: string;
  normalizedQuery: string;
};

const MODEL_LABELS: Record<string, string> = {
  "gpt-5-3": "GPT-5.3 Instant",
  "gpt-5-5-thinking": "GPT-5.5 Thinking",
  "gpt-5-5-pro": "GPT-5.5 Pro",
  "gpt-5-2": "GPT-5.2",
  "gpt-5-2-chat-latest": "GPT-5.2 Chat",
  "gpt-5-1": "GPT-5.1",
  "gpt-5-1-chat-latest": "GPT-5.1 Chat",
  "gpt-5": "GPT-5",
  "gpt-4o": "GPT-4o",
  "gpt-4o-mini": "GPT-4o Mini",
  "gpt-4-1": "GPT-4.1",
  "gpt-4": "GPT-4",
  o1: "o1",
  "o1-pro": "o1 Pro",
  "o1-mini": "o1 Mini",
  "o3-mini": "o3 Mini",
};

const normalizeModelQuery = (value: string): string => {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const clickModelAndDetect = async (
  clickModelAndDetectContext: ClickModelAndDetectContext,
): Promise<string> => {
  await clickModelAndDetectContext.item.click();
  await clickModelAndDetectContext.page
    .locator(SELECTORS.openMenu)
    .waitFor({ state: "hidden", timeout: 5_000 })
    .catch(() => {});
  await clickModelAndDetectContext.page.waitForTimeout(500);
  return detectCurrentModel(clickModelAndDetectContext.page);
};

const collectModelsFromItems = async (items: Locator[]): Promise<ModelOption[]> => {
  const models: ModelOption[] = [];
  for (const item of items) {
    const option = await parseModelMenuItem(item);
    if (option && !models.some((model) => model.id === option.id && model.label === option.label)) {
      models.push(option);
    }
  }
  return models;
};

const closeModelMenu = async (page: Page): Promise<void> => {
  await page.keyboard.press("Escape").catch(() => {});
};

const detectCheckedModelFromMenuOnce = async (page: Page): Promise<string | null> => {
  try {
    await openModelMenu(page);
    const checkedModel = await readCheckedModelFromOpenMenu(page);
    await page.keyboard.press("Escape").catch(() => {});
    return checkedModel;
  } catch {
    await page.keyboard.press("Escape").catch(() => {});
    return null;
  }
};

const detectCheckedModelFromMenu = async (page: Page): Promise<string | null> => {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const checkedModel = await detectCheckedModelFromMenuOnce(page);
    if (checkedModel) return checkedModel;
    await page.waitForTimeout(750);
  }
  return null;
};

export const detectCurrentModel = async (page: Page): Promise<string> => {
  try {
    const fromDom = await readCheckedModelFromDom(page);
    if (fromDom) return fromDom;
    const fromTrigger = await readModelFromTrigger(page);
    if (fromTrigger) return fromTrigger;
    const fromMenu = await detectCheckedModelFromMenu(page);
    if (fromMenu === null || fromMenu === undefined) return "ChatGPT";
    return fromMenu;
  } catch {
    return "ChatGPT";
  }
};

const findModelMenuMatch = async (
  findModelMenuMatchContext: FindModelMenuMatchContext,
): Promise<Locator | null> => {
  const items = await modelMenuItems(findModelMenuMatchContext.page);
  let fallback: Locator | null = null;
  for (const item of items) {
    const match = await modelItemMatchesQuery({
      item,
      normalizedQuery: findModelMenuMatchContext.normalizedQuery,
    });
    if (match.matched) return item;
    if (!fallback && match.fallback) fallback = match.fallback;
  }
  return fallback;
};

export const isLikelyModelLabel = (value: string): boolean => {
  return /\b(gpt|chatgpt|o[1-9]|claude|glm)\b/i.test(value);
};

const isSelectedModelItem = async (item: Locator): Promise<boolean> => {
  const ariaChecked = await item.getAttribute("aria-checked").catch(() => null);
  if (ariaChecked === "true") return true;
  const dataState = await item.getAttribute("data-state").catch(() => null);
  return dataState === "checked";
};

export const listAvailableModels = async (page: Page) => {
  await openModelMenu(page);
  const items = await modelMenuItems(page);
  const models = await collectModelsFromItems(items);
  await closeModelMenu(page);
  return models;
};

const modelItemMatch = (modelItemMatchRequest: ModelItemMatchInput): ModelItemMatchResult => {
  if (
    modelItemMatchRequest.searchable === modelItemMatchRequest.normalizedQuery ||
    modelItemMatchRequest.searchable.includes(modelItemMatchRequest.normalizedQuery)
  ) {
    return { matched: true, fallback: null };
  }
  const fallback = modelItemMatchRequest.normalizedQuery.includes(
    normalizeModelQuery(modelItemMatchRequest.label),
  )
    ? modelItemMatchRequest.item
    : null;
  return { matched: false, fallback };
};

const modelItemMatchesQuery = async (
  modelItemMatchesQueryContext: ModelItemMatchesQueryContext,
): Promise<ModelItemMatchResult> => {
  const label = await readModelItemLabel(modelItemMatchesQueryContext.item);
  const id = await readModelItemId(modelItemMatchesQueryContext.item);
  const searchable = normalizeModelQuery(`${label} ${id}`);
  if (!label || !isLikelyModelLabel(label)) return { matched: false, fallback: null };
  return modelItemMatch({
    item: modelItemMatchesQueryContext.item,
    label,
    normalizedQuery: modelItemMatchesQueryContext.normalizedQuery,
    searchable,
  });
};

const modelMenuItems = async (page: Page): Promise<Locator[]> => {
  return page
    .locator(
      [
        '[role="menu"] [role="menuitem"]',
        '[role="menu"] [role="menuitemradio"]',
        '[data-radix-menu-content] [role="menuitem"]',
        '[data-radix-menu-content] [role="menuitemradio"]',
        '[role="menu"] [data-testid^="model-switcher-"]',
        '[data-radix-menu-content] [data-testid^="model-switcher-"]',
      ].join(", "),
    )
    .all();
};

const clickModelTrigger = async (
  trigger: NonNullable<Awaited<ReturnType<typeof firstVisible>>>,
): Promise<void> => {
  try {
    await trigger.click({ timeout: 5_000 });
  } catch {
    await trigger.click({ timeout: 5_000, force: true });
  }
};

const openModelMenu = async (page: Page): Promise<void> => {
  await page
    .locator(SELECTORS.modelTrigger.join(", "))
    .first()
    .waitFor({ state: "visible", timeout: 5_000 })
    .catch(() => {});
  const trigger = await firstVisible({
    page: page,
    selectors: SELECTORS.modelTrigger,
  });
  if (!trigger) throw new Error("Could not find ChatGPT model switcher button.");
  await clickModelTrigger(trigger);
  await page.locator(SELECTORS.openMenu).first().waitFor({ state: "visible", timeout: 5_000 });
};

const parseModelMenuItem = async (item: Locator): Promise<ModelOption | null> => {
  const label = await readModelItemLabel(item);
  if (!label || !isLikelyModelLabel(label)) return null;
  const id = await readModelItemId(item);
  const selected = await isSelectedModelItem(item);
  return { id, label, selected };
};

const readCheckedModelFromDom = async (page: Page): Promise<string | null> => {
  const checked = page.locator('[data-testid^="model-switcher-"][aria-checked="true"]').first();
  if ((await checked.count()) > 0) {
    return readModelItemLabel(checked);
  }
  return null;
};

const readCheckedModelFromOpenMenu = async (page: Page): Promise<string | null> => {
  const items = await modelMenuItems(page);
  for (const item of items) {
    if (await isSelectedModelItem(item)) {
      const label = await readModelItemLabel(item);
      if (label) return label;
    }
  }
  return null;
};

const readLikelyAriaModelLabel = async (trigger: Locator): Promise<string | null> => {
  const ariaLabel = await trigger.getAttribute("aria-label").catch(() => null);
  return ariaLabel && isLikelyModelLabel(ariaLabel) ? ariaLabel.trim() : null;
};

const readLikelyModelLine = (text: string): string | null => {
  const modelLine = text.split("\n").find((part) => isLikelyModelLabel(part));
  if (modelLine === undefined) return null;
  return modelLine;
};

const readModelFromTrigger = async (page: Page): Promise<string | null> => {
  const trigger = await firstVisible({
    page: page,
    selectors: SELECTORS.modelTrigger,
  });
  if (!trigger) return null;
  const line = readLikelyModelLine(normalizeDisplayText(await trigger.innerText().catch(() => "")));
  if (line) return line;
  return readLikelyAriaModelLabel(trigger);
};

const readModelItemId = async (item: Locator): Promise<string> => {
  const testId = await item.getAttribute("data-testid").catch(() => null);
  if (testId?.startsWith("model-switcher-")) return testId.replace("model-switcher-", "");
  const label = await readModelItemLabel(item);
  return normalizeModelQuery(label).replace(/\s+/g, "-");
};

const readModelItemLabel = async (item: Locator): Promise<string> => {
  const testId = await item.getAttribute("data-testid").catch(() => null);
  if (testId?.startsWith("model-switcher-")) {
    const key = testId.replace("model-switcher-", "");
    if (MODEL_LABELS[key]) return MODEL_LABELS[key];
  }
  return normalizeDisplayText(await item.innerText().catch(() => ""));
};

const selectModelOrThrow = async (
  selectModelOrThrowContext: SelectModelOrThrowContext,
): Promise<string> => {
  await openModelMenu(selectModelOrThrowContext.page);
  const match = await findModelMenuMatch({
    page: selectModelOrThrowContext.page,
    normalizedQuery: selectModelOrThrowContext.normalizedQuery,
  });
  if (match) return clickModelAndDetect({ page: selectModelOrThrowContext.page, item: match });
  await closeModelMenu(selectModelOrThrowContext.page);
  throw new Error(
    `No model matched "${selectModelOrThrowContext.query}". Run /model to list available browser models.`,
  );
};

export const selectModel = async (page: Page, query: string): Promise<string> => {
  const normalizedQuery = normalizeModelQuery(query);
  if (!normalizedQuery) throw new Error("Model name is required.");
  return selectModelOrThrow({ page, query, normalizedQuery });
};
