import type { Page } from "playwright";
import { BRIDGE_CONNECTOR_PREFIX } from "../connector.constants.ts";
import type { ConnectorAppSummary } from "./connector.types.ts";
import { valueAfterLine } from "./connector-summary-helpers.ts";

/** Context for {@link parseConnectorSummaryLines}. */
export interface ParseConnectorSummaryLinesContext {
  /** Dialog text split into trimmed lines. */
  lines: string[];
}

/** Parse connector name and metadata lines from an open settings dialog. */
export function parseConnectorSummaryLines(ctx: ParseConnectorSummaryLinesContext): ConnectorAppSummary | null {
  const backIndex = ctx.lines.indexOf("Back");
  const name = backIndex >= 0 ? ctx.lines[backIndex + 1] ?? "" : "";
  if (!name.startsWith(BRIDGE_CONNECTOR_PREFIX)) return null;
  return {
    name,
    appId: valueAfterLine({ lines: ctx.lines, label: "App Id" }),
    url: valueAfterLine({ lines: ctx.lines, label: "URL" }),
  };
}

/** Context for {@link readOpenConnectorSummary}. */
export interface ReadOpenConnectorSummaryContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
}

/** Read connector details from the currently open settings dialog. */
export async function readOpenConnectorSummary(ctx: ReadOpenConnectorSummaryContext): Promise<ConnectorAppSummary | null> {
  const text = await ctx.page.locator('[role="dialog"]').last().innerText().catch(() => "");
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  return parseConnectorSummaryLines({ lines });
}
