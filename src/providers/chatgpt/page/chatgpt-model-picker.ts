import type { Locator, Page } from "playwright";
import type { ModelOption } from "@/connector-types.ts";
import {
  CHATGPT_APP_NAME,
  FIVE_SECONDS_MILLISECONDS,
  HALF_SECOND_MILLISECONDS,
  HIDDEN_WAIT_MODE,
} from "@/providers/chatgpt/page/chatgpt-page-constants.ts";
import { SELECTORS } from "@/providers/chatgpt/page/chatgpt-selectors.ts";
import {
  cleanModelQuery,
  closeModelMenu,
  collectModelsFromElements,
  detectCheckedModelFromMenu,
  readCheckedModelFromDom,
  readModelFromTrigger,
} from "@/providers/chatgpt/page/model-detection.ts";
import {
  findModelMenuHit,
  listModelMenuElements,
  listModelMenuLabels,
  openModelMenu,
  readNoModelMatchedMessage,
} from "@/providers/chatgpt/page/model-menu.ts";
import { probeOrFallback } from "@/providers/engine/browser-provider.ts";

export class ChatGptModelPicker {
  constructor(private readonly page: Page) {}

  detectCurrentModel = async (): Promise<string> => {
    return probeOrFallback(CHATGPT_APP_NAME, async () => {
      const fromDom = await readCheckedModelFromDom({ page: this.page });

      const isFromDomFound = fromDom != null && fromDom !== "";
      if (isFromDomFound) return fromDom;

      const fromTrigger = await readModelFromTrigger({ page: this.page });

      const isFromTriggerFound = fromTrigger != null && fromTrigger !== "";
      if (isFromTriggerFound) return fromTrigger;

      const fromMenu = await detectCheckedModelFromMenu({ page: this.page });

      const isFromMenuMissing = fromMenu == null;
      if (isFromMenuMissing) return CHATGPT_APP_NAME;

      return fromMenu;
    });
  };

  listAvailableModels = async (): Promise<ModelOption[]> => {
    await openModelMenu({ page: this.page });
    const elements = await listModelMenuElements(this.page);
    const models = await collectModelsFromElements({ items: elements });
    await closeModelMenu({ page: this.page });
    return models;
  };

  selectModel = async (query: string): Promise<string> => {
    const normalizedQuery = cleanModelQuery({ value: query });

    const isNormalizedQueryEmpty = !normalizedQuery;
    if (isNormalizedQueryEmpty) throw new Error("Model name is required.");

    return this.selectModelOrThrow(query, normalizedQuery);
  };

  private selectModelOrThrow = async (query: string, normalizedQuery: string): Promise<string> => {
    await openModelMenu({ page: this.page });

    const hit = await findModelMenuHit({ page: this.page, normalizedQuery });

    const isHitFound = hit != null;
    if (isHitFound) return this.clickModelAndDetect(hit);

    const seenLabels = await listModelMenuLabels({ page: this.page });
    await closeModelMenu({ page: this.page });
    const noModelMatchedMessage = readNoModelMatchedMessage({ query, seenLabels });
    throw new Error(noModelMatchedMessage);
  };

  private clickModelAndDetect = async (item: Locator): Promise<string> => {
    await item.click();
    await probeOrFallback(null, () =>
      this.page
        .locator(SELECTORS.openMenu)
        .waitFor({ state: HIDDEN_WAIT_MODE, timeout: FIVE_SECONDS_MILLISECONDS }),
    );
    await this.page.waitForTimeout(HALF_SECOND_MILLISECONDS);

    return this.detectCurrentModel();
  };
}
