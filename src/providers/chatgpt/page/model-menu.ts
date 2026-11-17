import type { Locator, Page } from "playwright";
import type { ModelOption } from "@/connector-types.ts";
import {
  FIVE_SECONDS_MILLISECONDS,
  LIST_SEPARATOR,
} from "@/providers/chatgpt/page/chatgpt-page-constants.ts";
import { SELECTORS } from "@/providers/chatgpt/page/chatgpt-selectors.ts";
import {
  cleanModelQuery,
  readFirstVisible,
  readModelElementId,
  readModelElementLabel,
} from "@/providers/chatgpt/page/model-detection.ts";
import { logUnlessElementMissing, probeOrFallback } from "@/providers/engine/browser-provider.ts";
import { VISIBLE_WAIT_MODE } from "@/providers/engine/page-probes.ts";

type FindModelMenuHitDetails = {
  page: Page;
  normalizedQuery: string;
};

export async function findModelMenuHit(details: FindModelMenuHitDetails): Promise<Locator | null> {
  const elements = await listModelMenuElements(details.page);
  let fallback: Locator | null = null;
  for (const element of elements) {
    const hit = await readModelElementHitReport({
      item: element,
      normalizedQuery: details.normalizedQuery,
    });

    const isMatched = hit.matched;
    if (isMatched) return element;

    const isFallbackEmpty = !fallback;

    const hasHitFallback = Boolean(hit.fallback);

    const isFirstFallbackFound = isFallbackEmpty && hasHitFallback;
    if (isFirstFallbackFound) fallback = hit.fallback;
  }
  return fallback;
}

export function isLikelyModelLabel(field: string): boolean {
  return /\b(gpt|chatgpt|o[1-9]|claude|glm)\b/i.test(field);
}

type IsSelectedModelElementDetails = {
  item: Locator;
};

export async function isSelectedModelElement(
  details: IsSelectedModelElementDetails,
): Promise<boolean> {
  const ariaChecked = await probeOrFallback(null, () => details.item.getAttribute("aria-checked"));

  const isAriaCheckedRequested = ariaChecked === "true";
  if (isAriaCheckedRequested) return true;

  const toggleStatus = await probeOrFallback(null, () => details.item.getAttribute("data-state"));
  return toggleStatus === "checked";
}

type ModelElementHitReportDetails = {
  item: Locator;
  normalizedQuery: string;
};

type ModelElementHitReport = {
  matched: boolean;
  fallback: Locator | null;
};

type ModelElementHitDetails = {
  item: Locator;
  label: string;
  normalizedQuery: string;
  searchable: string;
};

function readModelElementHit(details: ModelElementHitDetails): ModelElementHitReport {
  const isQueryMatched =
    details.searchable === details.normalizedQuery ||
    details.searchable.includes(details.normalizedQuery);
  if (isQueryMatched) {
    return { matched: true, fallback: null };
  }

  const cleanedLabelQuery = cleanModelQuery({ value: details.label });
  const isQueryContainingLabel = details.normalizedQuery.includes(cleanedLabelQuery);
  const fallback = isQueryContainingLabel ? details.item : null;
  return { matched: false, fallback };
}

async function readModelElementHitReport(
  details: ModelElementHitReportDetails,
): Promise<ModelElementHitReport> {
  const label = await readModelElementLabel({ item: details.item });
  const id = await readModelElementId({ item: details.item });
  const searchable = cleanModelQuery({ value: `${label} ${id}` });

  const isLabelUnusable = !label || !isLikelyModelLabel(label);
  if (isLabelUnusable) return { matched: false, fallback: null };

  return readModelElementHit({
    item: details.item,
    label,
    normalizedQuery: details.normalizedQuery,
    searchable,
  });
}

export async function listModelMenuElements(page: Page): Promise<Locator[]> {
  const modelMenuCssSelector = [
    '[role="menu"] [role="menuitem"]',
    '[role="menu"] [role="menuitemradio"]',
    '[data-radix-menu-content] [role="menuitem"]',
    '[data-radix-menu-content] [role="menuitemradio"]',
    '[role="menu"] [data-testid^="model-switcher-"]',
    '[data-radix-menu-content] [data-testid^="model-switcher-"]',
  ].join(LIST_SEPARATOR);

  return page.locator(modelMenuCssSelector).all();
}

type ClickModelTriggerDetails = {
  trigger: NonNullable<Awaited<ReturnType<typeof readFirstVisible>>>;
};

async function clickModelTrigger(details: ClickModelTriggerDetails): Promise<void> {
  try {
    await details.trigger.click({ timeout: FIVE_SECONDS_MILLISECONDS });
  } catch (error) {
    logUnlessElementMissing(error);
    await details.trigger.click({ timeout: FIVE_SECONDS_MILLISECONDS, force: true });
  }
}

type OpenModelMenuDetails = {
  page: Page;
};

export async function openModelMenu(details: OpenModelMenuDetails): Promise<void> {
  const modelTriggerSelector = SELECTORS.modelTrigger.join(LIST_SEPARATOR);
  await probeOrFallback(null, () =>
    details.page
      .locator(modelTriggerSelector)
      .first()
      .waitFor({ state: VISIBLE_WAIT_MODE, timeout: FIVE_SECONDS_MILLISECONDS }),
  );

  const trigger = await readFirstVisible({
    parent: details.page,
    selectors: SELECTORS.modelTrigger,
  });

  const isTriggerMissing = trigger == null;
  if (isTriggerMissing) throw new Error("Could not find ChatGPT model switcher button.");

  await clickModelTrigger({ trigger });
  await details.page
    .locator(SELECTORS.openMenu)
    .first()
    .waitFor({ state: VISIBLE_WAIT_MODE, timeout: FIVE_SECONDS_MILLISECONDS });
}

type ParseModelMenuElementDetails = {
  item: Locator;
};

export async function parseModelMenuElement(
  details: ParseModelMenuElementDetails,
): Promise<ModelOption | null> {
  const label = await readModelElementLabel({ item: details.item });

  const isLabelUnusable = !label || !isLikelyModelLabel(label);
  if (isLabelUnusable) return null;

  const id = await readModelElementId({ item: details.item });
  const selected = await isSelectedModelElement({ item: details.item });
  return { id, label, selected };
}

export function readNoModelMatchedMessage(details: {
  query: string;
  seenLabels: string[];
}): string {
  const isSeenLabelsEmpty = details.seenLabels.length === 0;
  if (isSeenLabelsEmpty)
    return `No model matched "${details.query}". The model menu opened but showed no model names.`;

  return `No model matched "${details.query}". The model menu showed: ${details.seenLabels.join(LIST_SEPARATOR)}.`;
}

export async function listModelMenuLabels(details: { page: Page }): Promise<string[]> {
  const elements = await listModelMenuElements(details.page);
  const labels: string[] = [];

  for (const element of elements) {
    const label = await readModelElementLabel({ item: element });

    const isLabelFound = label !== "";
    if (isLabelFound) labels.push(label);
  }

  return labels;
}
