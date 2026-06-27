import type { BrowserManager } from "../providers/chrome/browser-manager.ts";
import type { McpServerHandle, McpToolAction } from "../tools/server.ts";
import type { CloudflareTunnel } from "../tunnel/cloudflare.ts";
import type { LoadedHooksConfig } from "../user-config/hooks.ts";
import type { PermissionMode } from "../domain/permissions.ts";
import type { BridgeConfig, Message } from "../domain/types.ts";
import type { Orchestrator } from "./orchestrator.ts";
import type { ContextCounter } from "./context-counter.ts";
import type { EngineRuntimeState } from "./engine.options.types.ts";

/**
 * A fully wired, running bridge: browser + MCP server + orchestrator + session.
 */
export interface Engine {
  config: BridgeConfig;
  orchestrator: Orchestrator;
  counter: ContextCounter;
  browser: BrowserManager | null;
  mcpServer: McpServerHandle | null;
  tunnel: CloudflareTunnel | null;
  connectorUrl: string;
  hooksConfig: LoadedHooksConfig;
  toolActions: McpToolAction[];
  branch?: string;
  getSessionId(): string;
  setSessionId(id: string): void;
  getPermissionMode(): PermissionMode;
  setPermissionMode(mode: PermissionMode): void;
  ask(input: { content: string; timeoutMs?: number }): Promise<Message | null>;
  abort(): Promise<void>;
  shutdown(input?: { closeBrowser?: boolean }): Promise<void>;
}

/** Context for building the {@link Engine} object returned by {@link startEngine}. */
export interface BuildEngineContext {
  config: BridgeConfig;
  orchestrator: Orchestrator;
  counter: ContextCounter;
  browser: BrowserManager | null;
  mcpServer: McpServerHandle | null;
  tunnel: CloudflareTunnel | null;
  connectorUrl: string;
  hooksConfig: LoadedHooksConfig;
  toolActions: McpToolAction[];
  branch?: string;
  runtime: EngineRuntimeState;
}

export type { StartEngineOptions, EngineRuntimeState } from "./engine.options.types.ts";
