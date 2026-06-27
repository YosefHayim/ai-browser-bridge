import type { CommandContext } from "../../../../domain/types.ts";
import { normalizeProvider } from "../../../../providers/create-provider.factory.ts";
import {
  formatConnectorSetupResult,
  formatMcpDiagnostics,
  mcpConnectorUrl,
} from "../../formatters.ts";

/** Show MCP connector setup and exposed tools. */
export async function handleMcp(_args: string, ctx: CommandContext): Promise<void> {
  if (normalizeProvider(ctx.config.provider) === "gemini") {
    printGeminiMcpDiagnostics();
    return;
  }
  console.log(formatMcpDiagnostics(ctx));
}

/** Print Gemini MCP limitation diagnostics. */
function printGeminiMcpDiagnostics(): void {
  console.log([
    "MCP bridge diagnostics:",
    "Provider: Gemini web",
    "Local MCP tools are not available in gemini.google.com.",
    "Use @file mentions to inline repo files into prompts.",
    "",
    "For full MCP on Gemini, use the official Gemini API or Gemini CLI instead of the browser UI.",
  ].join("\n"));
}

/** Open ChatGPT MCP connector setup in the browser. */
export async function handleConnector(_args: string, ctx: CommandContext): Promise<void> {
  if (normalizeProvider(ctx.config.provider) === "gemini") {
    printGeminiConnectorWarning();
    return;
  }
  const connector = mcpConnectorUrl(ctx.config.tunnelUrl);
  if (!connector) {
    printMissingConnectorUrl(ctx);
    return;
  }
  await openConnectorSetup({ connector, ctx });
}

/** Print Gemini connector limitation message. */
function printGeminiConnectorWarning(): void {
  console.log(
    "Gemini web has no custom MCP connector UI. Use @file mentions for read-only repo context, or run with --provider chatgpt for full MCP tools.",
  );
}

/** Print guidance when no public connector URL exists. */
function printMissingConnectorUrl(ctx: CommandContext): void {
  console.log([
    "No public connector URL is available.",
    `Local MCP server: http://localhost:${ctx.config.mcpPort}`,
    "ChatGPT cannot normally reach localhost from the browser connector.",
    "Restart the bridge and fix Cloudflare Tunnel, then run /connector again.",
  ].join("\n"));
}

/** Run browser connector setup automation when available. */
async function openConnectorSetup(params: { connector: string; ctx: CommandContext }): Promise<void> {
  console.log(formatMcpDiagnostics(params.ctx));
  if (!params.ctx.orchestrator.openConnectorSetup) {
    console.log("\nBrowser setup automation is unavailable. Open ChatGPT Settings -> Apps -> Advanced settings -> Create app and paste the Connector URL.");
    return;
  }
  const result = await params.ctx.orchestrator.openConnectorSetup({ connectorUrl: params.connector });
  console.log(formatConnectorSetupResult(result));
}
