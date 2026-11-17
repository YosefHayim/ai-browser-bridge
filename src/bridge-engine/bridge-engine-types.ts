import type { BridgeSettings } from "@/bridge-types.ts";
import type { BrowserSession } from "@/browser/browser-session.ts";
import type { LoadedHooksSettings } from "@/hooks/hooks.ts";
import type { TokenCounter } from "@/orchestrator/context-counter.ts";
import type { Orchestrator } from "@/orchestrator/orchestrator.ts";
import type { PermissionMode } from "@/permissions.ts";
import type { McpServerHandle, McpToolAction } from "@/repo-tools-mcp/mcp-server.ts";
import type { CloudflareTunnel } from "@/tunnel/cloudflare-tunnel.ts";

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
  bridgeSettings: BridgeSettings;
  orchestrator: Orchestrator;
  counter: TokenCounter;
  browser: BrowserSession | null;
  mcpServer: McpServerHandle | null;
  tunnel: CloudflareTunnel | null;
  connectorUrl: string;
  hooksSettings: LoadedHooksSettings;
  toolActions: McpToolAction[];
  branch?: string;
  runtime: EngineRuntimeStatus;
  persistent: boolean;
};
