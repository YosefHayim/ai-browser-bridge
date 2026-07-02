import { BridgeEngine, mcpConnectorUrl } from "./internal/bridgeEngine.ts";

export type {
  StartEngineOptions,
  AskEngineInput,
  ShutdownEngineInput,
} from "./bridgeEngineTypes.ts";
export type { ContextCounter } from "./internal/bridgeEngine.ts";
export { BridgeEngine, mcpConnectorUrl };

/**
 * Wire up and start a bridge engine: config, MCP server, optional tunnel and
 * browser, orchestrator, and a fresh session.
 */
export async function startEngine(options: Parameters<typeof BridgeEngine.start>[0] = {}) {
  return BridgeEngine.start(options);
}
