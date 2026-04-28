export interface BridgeConfig {
  repoPath: string;
  browserProfilePath?: string;
  mcpPort: number;
  tunnelUrl?: string;
  contextLimit: number;
  model?: string;
  permissionMode?: BridgePermissionMode;
}

export type BridgePermissionMode = "read-only" | "ask" | "auto";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  ok: boolean;
  output: string;
  error?: string;
}

export interface Conversation {
  id: string;
  title: string;
  url: string;
}

export interface ModelOption {
  id: string;
  label: string;
  selected: boolean;
}

export interface ConnectorSetupResult {
  connectorUrl: string;
  completed: boolean;
  steps: string[];
  warnings: string[];
}

export interface ConnectorSetupOptions {
  connectorName?: string;
  automatic?: boolean;
}

export interface CommandContext {
  config: BridgeConfig;
  messages: Message[];
  sendMessage: (content: string) => Promise<void>;
  clearMessages?: () => void;
  shutdown?: () => Promise<void>;
  counter: {
    count: number;
    contextLimit: number;
    modelLabel: string;
    summary: string;
    setModel(modelName: string): void;
  };
  orchestrator: {
    listConversations(): Promise<Array<{ id: string; title: string; url: string }>>;
    navigateToConversation(url: string): Promise<void>;
    newConversation(): Promise<void>;
    model: string;
    detectModel(): Promise<string>;
    listModels(): Promise<ModelOption[]>;
    switchModel(query: string): Promise<string>;
    rewindLastPrompt(replacement?: string): Promise<void>;
    stopResponse(): Promise<boolean>;
    attachFiles?(paths: string[]): Promise<void>;
    openConnectorSetup?(connectorUrl: string, options?: ConnectorSetupOptions): Promise<ConnectorSetupResult>;
  };
  permission?: {
    getMode(): BridgePermissionMode;
    setMode(mode: BridgePermissionMode): void | Promise<void>;
  };
  session?: {
    getId(): string;
    setId(id: string): void | Promise<void>;
  };
  statusline?: {
    branch?: string;
    toolCallCount(): number;
  };
}

export interface CommandDef {
  name: string;
  aliases?: string[];
  hidden?: boolean;
  description: string;
  handler: (args: string, ctx: CommandContext) => Promise<void>;
}

import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { ZodType } from "zod";

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, ZodType>;
  annotations?: ToolAnnotations;
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}
