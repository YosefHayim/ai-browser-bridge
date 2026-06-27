/**
 * Knobs for {@link startEngine}. The two frontends (Ink TUI and the headless
 * `bridge ask` command) differ only in these flags.
 */
export interface StartEngineOptions {
  /** Target repository the MCP tools operate inside. */
  repoPath?: string;
  /** Browser provider (`chatgpt` or `gemini`). */
  provider?: import("../domain/types.ts").BridgeConfig["provider"];
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
  permissionMode: import("../domain/permissions.ts").PermissionMode;
}
