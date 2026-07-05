import type { PermissionMode } from "@/features/domain";
import type { BridgeConfig } from "@/features/domain";
import type { BrowserManager } from "@/features/providers";
import type { McpServerHandle, McpToolAction } from "@/features/tools";
import type { CloudflareTunnelClass } from "@/features/tunnel";
import type { LoadedHooksConfig } from "@/features/user-config";
import type { ContextCounter } from "./internal/bridgeEngine.ts";
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
  /** Number of generated images to wait for before returning (ChatGPT only). */
  expectImages?: number;
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
  tunnel: CloudflareTunnelClass | null;
  connectorUrl: string;
  hooksConfig: LoadedHooksConfig;
  toolActions: McpToolAction[];
  branch?: string;
  runtime: EngineRuntimeState;
}
