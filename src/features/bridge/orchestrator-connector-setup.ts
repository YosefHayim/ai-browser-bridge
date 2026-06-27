import type { Page } from "playwright";
import type { ConnectorSetupResult } from "../domain/types.ts";
import type { BrowserProvider } from "../providers/create-provider.factory.ts";
import type { ConnectorSetupInput, OrchestratorEvent } from "./orchestrator.types.ts";

/** Context for opening MCP connector setup in the browser. */
export interface OpenConnectorSetupContext extends ConnectorSetupInput {
  /** Playwright page handle, or null when disconnected. */
  page: Page | null;
  /** Browser provider implementation. */
  provider: BrowserProvider;
  /** Emit orchestrator events. */
  emit: (event: OrchestratorEvent) => void;
}

/** Open provider settings and best-effort fill the MCP connector form. */
export async function openConnectorSetup(ctx: OpenConnectorSetupContext): Promise<ConnectorSetupResult> {
  if (!ctx.provider.supportsMcpConnector || !ctx.provider.setupMcpConnector) {
    return unsupportedConnectorResult(ctx);
  }
  if (!ctx.page) return disconnectedConnectorResult(ctx);
  return runConnectorSetup(ctx);
}

/** Result when the provider does not support MCP connectors. */
function unsupportedConnectorResult(ctx: OpenConnectorSetupContext): ConnectorSetupResult {
  const result: ConnectorSetupResult = {
    connectorUrl: ctx.connectorUrl,
    completed: false,
    steps: [],
    warnings: [
      `${ctx.provider.displayName} web does not support custom MCP connectors.`,
      "Use @file mentions for read-only repo context, or switch to ChatGPT for full MCP tools.",
    ],
  };
  ctx.emit({ type: "status", text: "Connector setup is not available for this provider." });
  return result;
}

/** Result when the browser is not connected. */
function disconnectedConnectorResult(ctx: OpenConnectorSetupContext): ConnectorSetupResult {
  const result: ConnectorSetupResult = {
    connectorUrl: ctx.connectorUrl,
    completed: false,
    steps: [],
    warnings: ["Browser not connected. Open ChatGPT settings manually and paste the connector URL."],
  };
  ctx.emit({ type: "error", error: "Browser not connected." });
  return result;
}

/** Run connector setup through the provider when the page is connected. */
async function runConnectorSetup(ctx: OpenConnectorSetupContext): Promise<ConnectorSetupResult> {
  ctx.emit({
    type: "status",
    text: ctx.automatic ? "Syncing ChatGPT connector..." : "Opening ChatGPT connector setup...",
  });
  const result = await ctx.provider.setupMcpConnector!(ctx.page!, ctx.connectorUrl, {
    automatic: ctx.automatic,
    connectorName: ctx.connectorName,
  });
  ctx.emit({ type: "status", text: result.completed ? "Connector ready." : "Connector setup needs manual finish." });
  return result;
}
