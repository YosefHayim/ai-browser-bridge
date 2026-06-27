import type { CommandContext, ConnectorSetupResult } from "../../types/types.ts";
import type { SessionMetadata } from "../../core/session-store.ts";
import { toolRegistry } from "../../mcp/tools/registry.ts";

/**
 * Pure string builders for the diagnostic/status commands (`/status`, `/mcp`,
 * `/connector`, `/resume`). Separated from the command registry so the dispatch
 * layer stays small and these display helpers can be unit-tested in isolation.
 * None of them perform I/O — they format already-loaded context into text.
 */

/**
 * Normalise a tunnel URL into the connector endpoint ChatGPT points at.
 *
 * Returns null when no tunnel is configured (the bridge has no public URL),
 * which the callers render as "none". Accepts URLs already ending in `/mcp` or
 * `/sse` and otherwise appends `/mcp`.
 */
export function mcpConnectorUrl(tunnelUrl?: string): string | null {
  if (!tunnelUrl) return null;
  const normalized = tunnelUrl.replace(/\/+$/, "");
  return normalized.endsWith("/mcp") || normalized.endsWith("/sse") ? normalized : `${normalized}/mcp`;
}

/** Format a one-block summary of a resumed/loaded local session. */
export function formatSessionSummary(session: SessionMetadata, currentId?: string): string {
  const marker = session.id === currentId ? "current" : "loaded";
  return [
    `Local session ${marker}: ${session.id}`,
    `Repo: ${session.repoPath}`,
    `Model: ${session.model ?? "unknown"}`,
    `Context: ${session.contextLimit.toLocaleString()} tokens`,
    `Updated: ${session.updatedAt}`,
    `Tunnel: ${session.tunnelUrl ?? "none"}`,
  ].join("\n");
}

/** Format the `/status` / `/statusline` overview of the running bridge. */
export function formatBridgeStatus(ctx: CommandContext): string {
  const connector = mcpConnectorUrl(ctx.config.tunnelUrl);
  return [
    `Repo: ${ctx.config.repoPath}`,
    `Branch: ${ctx.statusline?.branch ?? "unknown"}`,
    `Session: ${ctx.session?.getId() ?? "none"}`,
    `Model: ${ctx.counter.modelLabel}`,
    `Context: ${ctx.counter.summary}`,
    `Permission: ${ctx.permission?.getMode() ?? ctx.config.permissionMode ?? "auto"}`,
    `Tool calls: ${ctx.statusline?.toolCallCount() ?? 0}`,
    `Tunnel: ${ctx.config.tunnelUrl ?? "none"}`,
    `Connector: ${connector ?? "none"}`,
  ].join("\n");
}

/** Format `/mcp` diagnostics, including exposed tools and connector-troubleshooting hints. */
export function formatMcpDiagnostics(ctx: CommandContext): string {
  const connector = mcpConnectorUrl(ctx.config.tunnelUrl);
  const toolCallCount = ctx.statusline?.toolCallCount() ?? 0;
  return [
    "MCP bridge diagnostics:",
    `Local server: http://localhost:${ctx.config.mcpPort}`,
    `Tunnel: ${ctx.config.tunnelUrl ?? "none"}`,
    `Connector: ${connector ?? "none"}`,
    `Tools: ${[...toolRegistry.keys()].join(", ")}`,
    `Tool calls observed this session: ${toolCallCount}`,
    `Status: ${toolCallCount > 0 ? "MCP tool calls observed in this bridge session." : "No MCP tool calls observed yet; the current ChatGPT chat may not have the connector enabled."}`,
    "",
    "If ChatGPT says it cannot access local files:",
    "1. Startup automatically syncs the current Connector URL into ChatGPT when browser automation is connected.",
    "2. Run /connector only to retry that browser setup flow after a UI drift or account permission issue.",
    "3. Ask explicitly: use the chatgpt-local-bridge connector; do not answer from memory.",
    "4. A reply mentioning /mnt/data, upload a zip, or paste tree/find output means ChatGPT is not using this local connector.",
  ].join("\n");
}

/** Format the result of the browser-automated ChatGPT connector setup flow. */
export function formatConnectorSetupResult(result: ConnectorSetupResult): string {
  return [
    "",
    "Connector setup result:",
    `URL: ${result.connectorUrl}`,
    `Submitted: ${result.completed ? "yes" : "no"}`,
    ...(result.steps.length > 0 ? ["", "Steps:", ...result.steps.map((step) => `- ${step}`)] : []),
    ...(result.warnings.length > 0 ? ["", "Needs manual attention:", ...result.warnings.map((warning) => `- ${warning}`)] : []),
    "",
    "Automatic startup handles this on each restart when the browser is connected. Manual fallback: ChatGPT Settings -> Apps -> Advanced settings -> Create app, paste the Connector URL, choose no authentication, then enable it in Developer Mode for this chat.",
  ].join("\n");
}
