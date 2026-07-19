// Public engine surface. Pure re-exports — no local imports mixed in.
export type {
  AskEngineInput,
  ShutdownEngineInput,
  StartEngineOptions,
} from "./bridgeEngineTypes.ts";
export type { ContextCounter } from "./internal/contextCounter.ts";
export { BridgeEngine, mcpConnectorUrl } from "./internal/bridgeEngine.ts";
