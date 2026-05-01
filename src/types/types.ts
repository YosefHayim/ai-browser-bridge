export interface BridgeConfig {
  repoPath: string;
  /** @deprecated Replaced by the isolated bridge profile at ~/.chatgpt-local-bridge/chrome-profile. Retained to avoid crashing on existing config files. */
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

export type AttachmentRole = "assistant" | "user";

/** Artifact discovered in a ChatGPT conversation. */
export interface Attachment {
  /** Stable placeholder id, e.g. "image-3", "user-image-2", "file-7", or "pdf-2". */
  id: string;
  role: AttachmentRole;
  kind: "image" | "file" | "pdf";
  /** Source URL from src or href; may be blob: or https:. */
  url: string;
  /** Filename from download metadata, alt text, or visible file pill text. */
  filename?: string;
  mime?: string;
  /** Zero-based message index for the attachment role in the conversation. */
  messageIndex: number;
  /** ISO timestamp for when the attachment was registered. */
  createdAt: string;
}

/** Per-conversation registry of captured attachments. */
export interface AttachmentManifest {
  conversationId: string;
  attachments: Attachment[];
  /** Last assigned numeric suffix per role and attachment kind. */
  counters?: Record<AttachmentRole, Record<Attachment["kind"], number>>;
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
