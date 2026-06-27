import type { ConnectorAppSummary, ConnectorSetupContext } from "./connector.types.ts";
import { deleteConnectorAppBySummary } from "./delete-connector-app-by-summary.ts";

/** Context for {@link deleteDuplicateTargets}. */
export interface DeleteDuplicateTargetsContext {
  /** Connector setup context with page and result accumulator. */
  setup: ConnectorSetupContext;
  /** Connector summaries that should be deleted. */
  deleteTargets: ConnectorAppSummary[];
}

/** Delete duplicate connector apps and record steps or warnings. */
export async function deleteDuplicateTargets(ctx: DeleteDuplicateTargetsContext): Promise<void> {
  for (const target of ctx.deleteTargets) {
    const deleted = await deleteConnectorAppBySummary({ page: ctx.setup.page, target });
    if (deleted) {
      ctx.setup.result.steps.push(`Deleted duplicate connector app: ${target.name}${target.url ? ` (${target.url})` : ""}.`);
    } else {
      ctx.setup.result.warnings.push(`Could not delete duplicate connector app: ${target.name}.`);
    }
  }
}
