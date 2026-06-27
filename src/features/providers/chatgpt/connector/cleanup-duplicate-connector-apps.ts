import type { ConnectorAppSummary, ConnectorSetupContext } from "./connector.types.ts";
import { listBridgeConnectorSummaries } from "./list-bridge-connector-summaries.ts";
import { openConnectorList } from "./open-connector-list.ts";
import { sameConnectorApp } from "./connector-summary-helpers.ts";
import { deleteDuplicateTargets } from "./delete-duplicate-targets.ts";

/** Context for {@link findDeleteTargets}. */
export interface FindDeleteTargetsContext {
  /** Connector summaries currently listed in settings. */
  summaries: ConnectorAppSummary[];
  /** Desired connector display name. */
  connectorName: string;
  /** Desired connector MCP URL. */
  connectorUrl: string;
}

/** Select connector summaries that should be deleted as duplicates or stale entries. */
export function findDeleteTargets(ctx: FindDeleteTargetsContext): ConnectorAppSummary[] {
  const current = ctx.summaries.find((summary) => summary.name === ctx.connectorName && summary.url === ctx.connectorUrl) ?? null;
  return ctx.summaries.filter((summary) => {
    if (summary.name !== ctx.connectorName) return true;
    if (summary.url !== ctx.connectorUrl) return true;
    return !!current && !sameConnectorApp({ a: summary, b: current });
  });
}

/** Remove duplicate bridge connector apps and return whether the desired connector exists. */
export async function cleanupDuplicateConnectorApps(ctx: ConnectorSetupContext): Promise<boolean> {
  const summaries = await listBridgeConnectorSummaries({ page: ctx.page });
  const current = summaries.find((summary) => summary.name === ctx.connectorName && summary.url === ctx.connectorUrl) ?? null;
  await deleteDuplicateTargets({ setup: ctx, deleteTargets: findDeleteTargets({ summaries, connectorName: ctx.connectorName, connectorUrl: ctx.connectorUrl }) });
  await openConnectorList({ page: ctx.page });
  return !!current;
}
