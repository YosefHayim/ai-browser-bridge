import type { Page } from "playwright";
import {
  cleanModelQuery,
  clickModelAndDetect,
  closeModelMenu,
} from "@/providers/chatgpt/page/model-detection.ts";
import {
  findModelMenuHit,
  listModelMenuLabels,
  openModelMenu,
  readNoModelMatchedMessage,
} from "@/providers/chatgpt/page/model-menu.ts";

type SelectModelOrThrowDetails = {
  page: Page;
  query: string;
  normalizedQuery: string;
};

async function selectModelOrThrow(details: SelectModelOrThrowDetails): Promise<string> {
  await openModelMenu({ page: details.page });

  const hit = await findModelMenuHit({
    page: details.page,
    normalizedQuery: details.normalizedQuery,
  });

  const isHitFound = hit != null;
  if (isHitFound) return clickModelAndDetect({ page: details.page, item: hit });

  const seenLabels = await listModelMenuLabels({ page: details.page });
  await closeModelMenu({ page: details.page });
  const noModelMatchedMessage = readNoModelMatchedMessage({ query: details.query, seenLabels });
  throw new Error(noModelMatchedMessage);
}

export async function selectModel(page: Page, query: string): Promise<string> {
  const normalizedQuery = cleanModelQuery({ value: query });

  const isNormalizedQueryEmpty = !normalizedQuery;
  if (isNormalizedQueryEmpty) throw new Error("Model name is required.");

  return selectModelOrThrow({ page, query, normalizedQuery });
}
