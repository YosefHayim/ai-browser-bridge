import type { Page } from "playwright";
import { clickConnectorListEntry } from "./click-connector-list-entry.ts";
import { readOpenConnectorSummary } from "./read-open-connector-summary.ts";

/** Context for {@link readConnectorSummaryAtIndex}. */
export interface ReadConnectorSummaryAtIndexContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
  /** Zero-based connector button index in the list. */
  index: number;
}

/** Open one connector by index and read its summary panel. */
export async function readConnectorSummaryAtIndex(ctx: ReadConnectorSummaryAtIndexContext) {
  if (!await clickConnectorListEntry({ page: ctx.page, index: ctx.index })) return null;
  return readOpenConnectorSummary({ page: ctx.page });
}
