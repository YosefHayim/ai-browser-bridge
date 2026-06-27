import type { Page } from "playwright";
import type { Locator } from "playwright";
import { normalizeModelQuery } from "../dom/normalize-model-query.ts";
import { clickModelAndDetect } from "./click-model-and-detect.ts";
import { findModelMenuMatch } from "./find-model-menu-match.ts";
import { openModelMenu } from "./open-model-menu.ts";
import { closeModelMenu } from "./collect-models-from-items.ts";

/** Context for {@link selectModelOrThrow}. */
export interface SelectModelOrThrowContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
  /** Original user-supplied model query for error messages. */
  query: string;
  /** Normalized model search query. */
  normalizedQuery: string;
}

/** Open the model menu, click a match, or throw when none is found. */
export async function selectModelOrThrow(ctx: SelectModelOrThrowContext): Promise<string> {
  await openModelMenu({ page: ctx.page });
  const match = await findModelMenuMatch({ page: ctx.page, normalizedQuery: ctx.normalizedQuery });
  if (match) return clickModelAndDetect({ page: ctx.page, item: match });
  await closeModelMenu({ page: ctx.page });
  throw new Error(`No model matched "${ctx.query}". Run /model to list available browser models.`);
}

/** Select a ChatGPT model by visible label, data-testid suffix, or fuzzy query. */
export async function selectModel(page: Page, query: string): Promise<string> {
  const normalizedQuery = normalizeModelQuery({ value: query });
  if (!normalizedQuery) throw new Error("Model name is required.");
  return selectModelOrThrow({ page, query, normalizedQuery });
}
