import { BridgeEngine, mcpConnectorUrl } from "./bridge-engine.class.ts";

export type { StartEngineOptions, AskEngineInput, ShutdownEngineInput, Engine } from "./bridge-engine.types.ts";
export { BridgeEngine, mcpConnectorUrl };

/**
 * Wire up and start a bridge engine: config, MCP server, optional tunnel and
 * browser, orchestrator, and a fresh session.
 */
export async function startEngine(options: Parameters<typeof BridgeEngine.start>[0] = {}) {
  return BridgeEngine.start(options);
}

export type { BridgeEngine as EngineInstance };
