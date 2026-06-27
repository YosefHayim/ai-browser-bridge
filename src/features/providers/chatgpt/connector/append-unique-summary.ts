import type { ConnectorAppSummary } from "./connector.types.ts";
import { connectorSummaryKey } from "./connector-summary-helpers.ts";

/** Context for {@link appendUniqueSummary}. */
export interface AppendUniqueSummaryContext {
  /** Accumulated connector summaries. */
  summaries: ConnectorAppSummary[];
  /** Keys already collected while enumerating connectors. */
  seen: Set<string>;
  /** Candidate summary to append when unique. */
  summary: ConnectorAppSummary | null;
}

/** Append a summary when its deduplication key has not been seen. */
export function appendUniqueSummary(ctx: AppendUniqueSummaryContext): void {
  if (!ctx.summary) return;
  const key = connectorSummaryKey({ summary: ctx.summary });
  if (ctx.seen.has(key)) return;
  ctx.seen.add(key);
  ctx.summaries.push(ctx.summary);
}
