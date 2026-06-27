import type { Page } from "playwright";
import type { ConnectorSetupOptions, ConnectorSetupResult } from "../../../domain/types.ts";

/** Mutable context passed through connector setup steps. */
export interface ConnectorSetupContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
  /** MCP connector URL to register in ChatGPT settings. */
  connectorUrl: string;
  /** Connector setup options from the caller. */
  options: ConnectorSetupOptions;
  /** Connector display name resolved from options or defaults. */
  connectorName: string;
  /** URL to restore after automatic setup attempts. */
  returnUrl: string | null;
  /** Accumulated setup result returned to the caller. */
  result: ConnectorSetupResult;
}

/** State of an existing connector relative to the desired URL. */
export type ExistingConnectorState = "missing" | "current" | "stale" | "unknown";

/** Summary of a bridge connector app listed in ChatGPT settings. */
export interface ConnectorAppSummary {
  /** Connector display name shown in settings. */
  name: string;
  /** ChatGPT-assigned app id, when readable from the panel. */
  appId: string | null;
  /** Registered MCP endpoint URL, when readable from the panel. */
  url: string | null;
}
