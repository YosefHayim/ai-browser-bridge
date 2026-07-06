export type {
  StartEngineOptions,
  AskEngineInput,
  ShutdownEngineInput,
} from "./bridgeEngineTypes.ts";
export type { ContextCounter } from "./internal/bridgeEngine.ts";
export { BridgeEngine, mcpConnectorUrl } from "./internal/bridgeEngine.ts";

import { BridgeEngine } from "./internal/bridgeEngine.ts";

/**
 * Wire up and start a bridge engine: config, MCP server, optional tunnel and
 * browser, orchestrator, and a fresh session.
 *
 * @param options - Options that configure the operation.
 * @returns The `startEngine` result.
 * @example
 * ```ts
 * const result = await startEngine(options);
 * ```
 */
export const startEngine = async (options: Parameters<typeof BridgeEngine.start>[0] = {}) => {
  return BridgeEngine.start(options);
};
