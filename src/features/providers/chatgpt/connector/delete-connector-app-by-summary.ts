import type { ConnectorAppSummary, ConnectorSetupContext } from "./connector.types.ts";
import { deleteOpenConnectorIfPresent } from "./delete-open-connector.ts";
import { findBridgeConnectorButtons } from "./find-bridge-connector-buttons.ts";
import { openConnectorList } from "./open-connector-list.ts";
import { readOpenConnectorSummary } from "./read-open-connector-summary.ts";
import { sameConnectorApp } from "./connector-summary-helpers.ts";

/** Context for {@link deleteConnectorAppBySummary}. */
export interface DeleteConnectorAppBySummaryContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: ConnectorSetupContext["page"];
  /** Connector summary identifying the app to delete. */
  target: ConnectorAppSummary;
}

/** Delete one connector app by locating and opening its summary panel. */
export async function deleteConnectorAppBySummary(ctx: DeleteConnectorAppBySummaryContext): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await openConnectorList({ page: ctx.page });
    const entries = await findBridgeConnectorButtons({ page: ctx.page });
    for (const entry of entries) {
      if (entry.name !== ctx.target.name) continue;
      await entry.button.click({ timeout: 3_000, force: true });
      await ctx.page.waitForTimeout(1_000);
      const open = await readOpenConnectorSummary({ page: ctx.page });
      if (!open || !sameConnectorApp({ a: open, b: ctx.target })) continue;
      return deleteOpenConnectorIfPresent({ page: ctx.page });
    }
  }
  return false;
}
