import type { StartEngineOptions } from "./engine.types.ts";
import { bootEngine } from "./engine-boot.ts";
import { buildEngine } from "./build-engine.ts";

export type { StartEngineOptions, Engine } from "./engine.types.ts";
export { mcpConnectorUrl } from "./mcp-connector-url.ts";

/**
 * Wire up and start a bridge engine: config, MCP server, optional tunnel and
 * browser, orchestrator, and a fresh session.
 */
export async function startEngine(options: StartEngineOptions = {}) {
  return buildEngine(await bootEngine(options));
}
