import { normalizeDisplayText } from "../dom/normalize-display-text.ts";

/** Context for {@link normalizeConnectorListLabel}. */
export interface NormalizeConnectorListLabelContext {
  /** Raw connector list button label text. */
  value: string;
}

/** Normalize connector list button labels for comparison. */
export function normalizeConnectorListLabel(ctx: NormalizeConnectorListLabelContext): string {
  return normalizeDisplayText({ value: ctx.value })
    .replace(/\s+/g, "")
    .replace(/DEV$/i, "");
}

/** Context for {@link valueAfterLine}. */
export interface ValueAfterLineContext {
  /** Dialog text split into trimmed lines. */
  lines: string[];
  /** Label line whose following value should be read. */
  label: string;
}

/** Read the line immediately following a label in dialog text. */
export function valueAfterLine(ctx: ValueAfterLineContext): string | null {
  const index = ctx.lines.indexOf(ctx.label);
  const value = index >= 0 ? ctx.lines[index + 1] : null;
  return value?.trim() || null;
}

/** Context for {@link connectorSummaryKey}. */
export interface ConnectorSummaryKeyContext {
  /** Connector app summary to key. */
  summary: { name: string; appId: string | null; url: string | null };
}

/** Build a deduplication key for connector summaries. */
export function connectorSummaryKey(ctx: ConnectorSummaryKeyContext): string {
  return `${ctx.summary.name}\u0000${ctx.summary.appId ?? ""}\u0000${ctx.summary.url ?? ""}`;
}

/** Context for {@link sameConnectorApp}. */
export interface SameConnectorAppContext {
  /** First connector summary. */
  a: { appId: string | null; name: string; url: string | null };
  /** Second connector summary. */
  b: { appId: string | null; name: string; url: string | null };
}

/** True when two connector summaries refer to the same app. */
export function sameConnectorApp(ctx: SameConnectorAppContext): boolean {
  if (ctx.a.appId && ctx.b.appId) return ctx.a.appId === ctx.b.appId;
  return ctx.a.name === ctx.b.name && ctx.a.url === ctx.b.url;
}
