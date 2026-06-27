import type { Page } from "playwright";
import type { ExistingConnectorState } from "./connector.types.ts";
import { settingsDialogText } from "./settings-dialog-text.ts";

/** Context for {@link readOpenConnectorState}. */
export interface ReadOpenConnectorStateContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
  /** Expected connector display name. */
  connectorName: string;
  /** Desired connector MCP URL. */
  connectorUrl: string;
}

/** Classify the open connector panel relative to the desired connector URL. */
export async function readOpenConnectorState(ctx: ReadOpenConnectorStateContext): Promise<ExistingConnectorState> {
  const text = await settingsDialogText({ page: ctx.page });
  if (!text.includes(ctx.connectorName) || !/\b(URL|App Id|Version Id)\b/i.test(text)) return "missing";
  if (text.includes(ctx.connectorUrl)) return "current";
  if (/\bURL\s+https?:\/\//i.test(text)) return "stale";
  return "unknown";
}
