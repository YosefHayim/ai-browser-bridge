import type { BrowserSession } from "@/features/browser/browserSession.ts";
import type { LoadedHooksConfig } from "@/features/hooks/hooks.ts";
import type { McpToolAction, RepoMcpHandle } from "@/features/repoMcp/repoMcpServer.ts";
import type { PermissionMode } from "@/features/repoMcp/toolPermissions.ts";
import type { CloudflareTunnel } from "@/features/tunnel/cloudflareTunnel.ts";
import type { BrowserConversation } from "../conversation/BrowserConversation.ts";
import type { ConversationTokenCounter } from "../conversation/ConversationTokenCounter.ts";

export type BridgeConfig = {
  // Absolute path to the repo the bridge drives against.
  repoPath: string;
  provider?: string;
  mcpPort: number;
  tunnelUrl?: string;
  contextLimit: number;
  model?: string;
  permissionMode?: PermissionMode;
};

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
  conversation: BrowserConversation;
  counter: ConversationTokenCounter;
  browser: BrowserSession | null;
  mcpServer: RepoMcpHandle | null;
  tunnel: CloudflareTunnel | null;
  connectorUrl: string;
  hooksConfig: LoadedHooksConfig;
  toolActions: McpToolAction[];
  branch?: string;
  runtime: EngineRuntimeState;
  persistent: boolean;
};
