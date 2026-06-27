import type { Page } from "playwright";
import type { ConnectorAppSummary } from "./connector.types.ts";
import { appendUniqueSummary } from "./append-unique-summary.ts";
import { findBridgeConnectorButtons } from "./find-bridge-connector-buttons.ts";
import { openConnectorList } from "./open-connector-list.ts";
import { readConnectorSummaryAtIndex } from "./read-connector-summary-at-index.ts";

/** Context for {@link collectConnectorSummaries}. */
export interface CollectConnectorSummariesContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
  /** Number of connector buttons currently listed. */
  entryCount: number;
}

/** Collect unique connector summaries by opening each listed connector. */
export async function collectConnectorSummaries(ctx: CollectConnectorSummariesContext): Promise<ConnectorAppSummary[]> {
  const summaries: ConnectorAppSummary[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < ctx.entryCount; index += 1) {
    appendUniqueSummary({
      summaries,
      seen,
      summary: await readConnectorSummaryAtIndex({ page: ctx.page, index }),
    });
  }
  return summaries;
}

/** Context for {@link listBridgeConnectorSummaries}. */
export interface ListBridgeConnectorSummariesContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/** Enumerate all bridge connector apps listed in ChatGPT settings. */
export async function listBridgeConnectorSummaries(ctx: ListBridgeConnectorSummariesContext): Promise<ConnectorAppSummary[]> {
  await openConnectorList({ page: ctx.page });
  const entryCount = (await findBridgeConnectorButtons({ page: ctx.page })).length;
  const summaries = await collectConnectorSummaries({ page: ctx.page, entryCount });
  await openConnectorList({ page: ctx.page });
  return summaries;
}
