import type { Page } from "playwright";
import type { BridgePermissionMode } from "../domain/types.ts";
import type { HookDefinition } from "../user-config/hooks.ts";

/** Lifecycle event emitted when an MCP tool runs. */
export interface McpToolAction {
  name: string;
  status: "started" | "completed" | "blocked" | "failed";
  data?: Record<string, unknown>;
}

/** Hooks and callbacks wired into the MCP server. */
export interface McpServerOptions {
  getPage?: () => Page | null | undefined;
  getPermissionMode?: () => BridgePermissionMode;
  hooks?: readonly HookDefinition[];
  onToolAction?: (action: McpToolAction) => void | Promise<void>;
}

/** A running MCP server: its local base URL and a handle to stop it. */
export interface McpServerHandle {
  url: string;
  close: () => void;
}

/** Internal SSE transport pairing. */
export interface McpConnection {
  server: import("@modelcontextprotocol/sdk/server/mcp.js").McpServer;
  transport: import("@modelcontextprotocol/sdk/server/sse.js").SSEServerTransport;
}

/** Internal streamable HTTP transport pairing. */
export interface StreamableMcpConnection {
  server: import("@modelcontextprotocol/sdk/server/mcp.js").McpServer;
  transport: import("@modelcontextprotocol/sdk/server/streamableHttp.js").StreamableHTTPServerTransport;
}
