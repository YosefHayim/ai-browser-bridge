import type { BrowserSession } from "@/browser/browser-session.ts";
import type { CloudflareTunnel } from "@/cloudflare-tunnel.ts";
import type { BridgeSettings } from "@/domain/bridge-types.ts";
import type { PermissionMode } from "@/domain/permissions.ts";
import type { McpServerHandle, McpToolAction } from "@/tools/mcp-server.ts";
import type { LoadedHooksSettings } from "@/user-config/hooks.ts";
import type { TokenCounter } from "./context-counter.ts";
import type { Orchestrator } from "./orchestrator.ts";

export type StartEngineSettings = {
  repoPath: string | null;
  provider?: BridgeSettings["provider"];
  mcpPort?: number;
  withBrowser?: boolean;
  debugPort?: number;
  profileRoot: string | null;
  withTools?: boolean;
  withTunnel?: boolean;
  persist?: boolean;
  log?: (line: string) => void;
};

export type EngineRuntimeStatus = {
  sessionId: string;
  permissionMode: PermissionMode;
};

export type AskEngineDetails = {
  content: string;
  timeoutMilliseconds?: number;
  expectImages?: number;
};

export type ShutdownEngineDetails = {
  closeBrowser?: boolean;
};

export type EngineAssembly = {
  config: BridgeSettings;
  orchestrator: Orchestrator;
  counter: TokenCounter;
  browser: BrowserSession | null;
  mcpServer: McpServerHandle | null;
  tunnel: CloudflareTunnel | null;
  connectorUrl: string;
  hooksConfig: LoadedHooksSettings;
  toolActions: McpToolAction[];
  branch?: string;
  runtime: EngineRuntimeStatus;
  persistent: boolean;
};
