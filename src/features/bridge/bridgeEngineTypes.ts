import type { BrowserSession } from "@/features/browser";
import type { BridgeConfig, PermissionMode } from "@/features/domain";
import type { McpServerHandle, McpToolAction } from "@/features/tools";
import type { CloudflareTunnel } from "@/features/tunnel";
import type { LoadedHooksConfig } from "@/features/userConfig";
import type { ContextCounter } from "./contextCounter.ts";
import type { Orchestrator } from "./orchestrator.ts";

/** Knobs for BridgeEngine.start — TUI and headless ask differ only here. */
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

/** Mutable session and permission state shared by engine methods. */
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

/** Assembled runtime handed to the BridgeEngine constructor after boot. */
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
