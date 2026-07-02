import type { PermissionMode } from "../domain/permissions.ts";
import type { BridgeConfig, Message } from "../domain/types.ts";
import type { BrowserManager } from "../providers/chrome/browserManager.ts";
import type { McpServerHandle, McpToolAction } from "../tools/server.ts";
import type { CloudflareTunnel } from "../tunnel/cloudflareTunnel.ts";
import type { LoadedHooksConfig } from "../user-config/hooks.ts";
import type { ContextCounter } from "./bridgeEngine.ts";
import type { Orchestrator } from "./orchestrator.ts";

/**
 * Knobs for {@link BridgeEngine.start}. The two frontends (Ink TUI and the headless
 * `bridge ask` command) differ only in these flags.
 */
export interface StartEngineOptions {
  /** Target repository the MCP tools operate inside. */
  repoPath?: string;
  /** Browser provider (`chatgpt` or `gemini`). */
  provider?: BridgeConfig["provider"];
  /** MCP server port. Defaults to the saved port or 8765. */
  mcpPort?: number;
  /** Launch/attach Chrome. */
  withBrowser?: boolean;
  /** Start the local MCP server. Defaults to true. */
  withTools?: boolean;
  /** Start the Cloudflare tunnel + sync the ChatGPT connector. */
  withTunnel?: boolean;
  /** Diagnostics sink. Defaults to stderr. */
  log?: (line: string) => void;
}

/** Mutable session and permission state shared by engine methods. */
export interface EngineRuntimeState {
  /** Active session id for persistence. */
  sessionId: string;
  /** Current permission mode for MCP tool calls. */
  permissionMode: PermissionMode;
}

/** Input for {@link BridgeEngine.ask}. */
export interface AskEngineInput {
  /** User prompt text. */
  content: string;
  /** Optional timeout override in milliseconds. */
  timeoutMs?: number;
}

/** Input for {@link BridgeEngine.shutdown}. */
export interface ShutdownEngineInput {
  /** Whether to close the browser on shutdown. */
  closeBrowser?: boolean;
}

/** Context for building a running {@link BridgeEngine}. */
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

/** @deprecated Use {@link BridgeEngine} directly. */
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
  ask(input: AskEngineInput): Promise<Message | null>;
  abort(): Promise<void>;
  shutdown(input?: ShutdownEngineInput): Promise<void>;
}
