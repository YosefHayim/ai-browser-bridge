import type { Locator, Page } from "playwright";
import type { ModelOption } from "@/connector-types.ts";
import {
  ARIA_LABEL_ATTRIBUTE,
  DASH,
  NEWLINE,
  SPACE,
  TEST_ID_ATTRIBUTE,
} from "@/providers/chatgpt/page/chatgpt-page-constants.ts";
import { SELECTORS } from "@/providers/chatgpt/page/chatgpt-selectors.ts";
import {
  isLikelyModelLabel,
  isSelectedModelElement,
  listModelMenuElements,
  openModelMenu,
  parseModelMenuElement,
} from "@/providers/chatgpt/page/model-menu.ts";
import {
  logUnlessElementMissing,
  probeOrFallback,
  readVisibleCopy,
} from "@/providers/engine/browser-provider.ts";
import { ESCAPE_KEY } from "@/providers/engine/page-probes.ts";

const MODEL_SWITCHER_TEST_ID_PREFIX = "model-switcher-";

const THREE_QUARTER_SECOND_MILLISECONDS = 750;

type FirstVisibleDetails = {
  parent: Page | Locator;
  selectors: readonly string[];
};

export async function readFirstVisible(details: FirstVisibleDetails): Promise<Locator | null> {
  for (const selector of details.selectors) {
    const locator = details.parent.locator(selector).filter({ visible: true }).first();
    const locatorCount = await locator.count();

    const hasLocatorHit = locatorCount > 0;
    if (hasLocatorHit) return locator;
  }
  return null;
}

type NormalizeDisplayStringDetails = {
  value: string;
};

export function cleanDisplayString(details: NormalizeDisplayStringDetails): string {
  return details.value
    .replace(/\s+/g, SPACE)
    .replace(/\b(current|selected)\b/gi, "")
    .trim();
}

type NormalizeModelQueryDetails = {
  value: string;
};

export function cleanModelQuery(details: NormalizeModelQueryDetails): string {
  return details.value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, SPACE)
    .replace(/\s+/g, SPACE)
    .trim();
}

type CollectModelsFromElementsDetails = {
  items: Locator[];
};

export async function collectModelsFromElements(
  details: CollectModelsFromElementsDetails,
): Promise<ModelOption[]> {
  const models: ModelOption[] = [];
  for (const element of details.items) {
    const option = await parseModelMenuElement({ item: element });

    const isOptionNotListed =
      option && !models.some((model) => model.id === option.id && model.label === option.label);
    if (isOptionNotListed) {
      models.push(option);
    }
  }
  return models;
}

type CloseModelMenuDetails = {
  page: Page;
};

export async function closeModelMenu(details: CloseModelMenuDetails): Promise<void> {
  await probeOrFallback(null, () => details.page.keyboard.press(ESCAPE_KEY));
}

type DetectCheckedModelFromMenuOnceDetails = {
  page: Page;
};

async function detectCheckedModelFromMenuOnce(
  details: DetectCheckedModelFromMenuOnceDetails,
): Promise<string | null> {
  try {
    await openModelMenu({ page: details.page });
    const checkedModel = await readCheckedModelFromOpenMenu({ page: details.page });
    await probeOrFallback(null, () => details.page.keyboard.press(ESCAPE_KEY));
    return checkedModel;
  } catch (error) {
    logUnlessElementMissing(error);
    await probeOrFallback(null, () => details.page.keyboard.press(ESCAPE_KEY));
    return null;
  }
}

type DetectCheckedModelFromMenuDetails = {
  page: Page;
};

export async function detectCheckedModelFromMenu(
  details: DetectCheckedModelFromMenuDetails,
): Promise<string | null> {
  const maxMenuReadAttempts = 4;

  for (let attempt = 0; attempt < maxMenuReadAttempts; attempt += 1) {
    const checkedModel = await detectCheckedModelFromMenuOnce({ page: details.page });

    const isCheckedModelFound = checkedModel != null && checkedModel !== "";
    if (isCheckedModelFound) return checkedModel;

    await details.page.waitForTimeout(THREE_QUARTER_SECOND_MILLISECONDS);
  }
  return null;
}

type ReadCheckedModelFromDomDetails = {
  page: Page;
};

export async function readCheckedModelFromDom(
  details: ReadCheckedModelFromDomDetails,
): Promise<string | null> {
  const checked = details.page
    .locator('[data-testid^="model-switcher-"][aria-checked="true"]')
    .first();
  const checkedCount = await checked.count();

  const hasCheckedElement = checkedCount > 0;
  if (hasCheckedElement) {
    return readModelElementLabel({ item: checked });
  }

  return null;
}

type ReadCheckedModelFromOpenMenuDetails = {
  page: Page;
};

async function readCheckedModelFromOpenMenu(
  details: ReadCheckedModelFromOpenMenuDetails,
): Promise<string | null> {
  const elements = await listModelMenuElements(details.page);

  for (const element of elements) {
    const isSelectedModel = await isSelectedModelElement({ item: element });
    if (isSelectedModel) {
      const label = await readModelElementLabel({ item: element });

      const isLabelFound = label !== "";
      if (isLabelFound) return label;
    }
  }

  return null;
}

type ReadLikelyAriaModelLabelDetails = {
  trigger: Locator;
};

async function readLikelyAriaModelLabel(
  details: ReadLikelyAriaModelLabelDetails,
): Promise<string | null> {
  const ariaLabel = await probeOrFallback(null, () =>
    details.trigger.getAttribute(ARIA_LABEL_ATTRIBUTE),
  );
  const isLabelUsable = ariaLabel && isLikelyModelLabel(ariaLabel);
  return isLabelUsable ? ariaLabel.trim() : null;
}

type ReadLikelyModelLineDetails = {
  text: string;
};

function readLikelyModelLine(details: ReadLikelyModelLineDetails): string | null {
  const modelLine = details.text.split(NEWLINE).find((part) => isLikelyModelLabel(part));

  const isModelLineMissing = modelLine == null;
  if (isModelLineMissing) return null;

  return modelLine;
}

type ReadModelFromTriggerDetails = {
  page: Page;
};

export async function readModelFromTrigger(
  details: ReadModelFromTriggerDetails,
): Promise<string | null> {
  const trigger = await readFirstVisible({
    parent: details.page,
    selectors: SELECTORS.modelTrigger,
  });

  const isTriggerMissing = trigger == null;
  if (isTriggerMissing) return null;

  const line = readLikelyModelLine({
    text: cleanDisplayString({ value: await probeOrFallback("", () => readVisibleCopy(trigger)) }),
  });

  const isLineFound = line != null && line !== "";
  if (isLineFound) return line;

  return readLikelyAriaModelLabel({ trigger });
}

type ReadModelElementIdDetails = {
  item: Locator;
};

export async function readModelElementId(details: ReadModelElementIdDetails): Promise<string> {
  const testId = await probeOrFallback(null, () => details.item.getAttribute(TEST_ID_ATTRIBUTE));

  const hasTestId = testId != null;

  const isModelSwitcherTestId = hasTestId && testId.startsWith(MODEL_SWITCHER_TEST_ID_PREFIX);
  if (isModelSwitcherTestId) return testId.replace(MODEL_SWITCHER_TEST_ID_PREFIX, "");

  const label = await readModelElementLabel({ item: details.item });
  return cleanModelQuery({ value: label }).replace(/\s+/g, DASH);
}

type ReadModelElementLabelDetails = {
  item: Locator;
};

export async function readModelElementLabel(
  details: ReadModelElementLabelDetails,
): Promise<string> {
  const testId = await probeOrFallback(null, () => details.item.getAttribute(TEST_ID_ATTRIBUTE));

  const hasTestId = testId != null;

  const isModelSwitcherTestId = hasTestId && testId.startsWith(MODEL_SWITCHER_TEST_ID_PREFIX);
  if (isModelSwitcherTestId) {
    const key = testId.replace(MODEL_SWITCHER_TEST_ID_PREFIX, "");

    const modelLabel = {
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
    }[key];

    const isModelLabelFound = modelLabel != null && modelLabel !== "";
    if (isModelLabelFound) return modelLabel;
  }

  return cleanDisplayString({
    value: await probeOrFallback("", () => readVisibleCopy(details.item)),
  });
}
