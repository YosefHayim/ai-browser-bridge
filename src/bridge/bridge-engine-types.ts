import type { BrowserSession } from "@/browser/browser-session.ts";
import type { CloudflareTunnel } from "@/cloudflare-tunnel.ts";
import type { BridgeConfig } from "@/domain/bridge-types.ts";
import type { PermissionMode } from "@/domain/permissions.ts";
import type { McpServerHandle, McpToolAction } from "@/tools/mcp-server.ts";
import type { LoadedHooksConfig } from "@/user-config/hooks.ts";
import type { ContextCounter } from "./context-counter.ts";
import type { Orchestrator } from "./orchestrator.ts";

export type StartEngineOptions = {
  repoPath?: string;
  provider?: BridgeConfig["provider"];
  mcpPort?: number;
  withBrowser?: boolean;
  debugPort?: number;
  profileRoot?: string;
  withTools?: boolean;
  withTunnel?: boolean;
  persist?: boolean;
  log?: (line: string) => void;
};

export type EngineRuntimeState = {
  sessionId: string;
  permissionMode: PermissionMode;
};

export type AskEngineInput = {
  content: string;
  timeoutMs?: number;
  expectImages?: number;
};

export type ShutdownEngineInput = {
  closeBrowser?: boolean;
};

export type EngineAssembly = {
  config: BridgeConfig;
  orchestrator: Orchestrator;
  counter: ContextCounter;
  browser: BrowserSession | null;
  mcpServer: McpServerHandle | null;
  tunnel: CloudflareTunnel | null;
  connectorUrl: string;
  hooksConfig: LoadedHooksConfig;
  toolActions: McpToolAction[];
  branch?: string;
  runtime: EngineRuntimeState;
  persistent: boolean;
};
