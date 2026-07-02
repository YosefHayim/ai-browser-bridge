import type { PermissionMode } from "../permissions.ts";
import type { BridgeConfig } from "./bridgeTypes.ts";
import type { ConnectorSetupResult, ModelOption } from "./connectorTypes.ts";
import type { Message } from "./messageTypes.ts";

/** Runtime context passed to slash command handlers. */
export interface CommandContext {
  /** Active bridge configuration. */
  config: BridgeConfig;
  /** Messages captured in the current session. */
  messages: Message[];
  /** Send a user prompt through the orchestrator. */
  sendMessage: (content: string) => Promise<void>;
  /** Clear the in-memory message list. */
  clearMessages?: () => void;
  /** Gracefully shut down the bridge engine. */
  shutdown?: () => Promise<void>;
  /** Context window counter for the status line. */
  counter: {
    count: number;
    contextLimit: number;
    modelLabel: string;
    summary: string;
    setModel(modelName: string): void;
  };
  /** Browser orchestration surface for commands. */
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
    openConnectorSetup?(input: {
      connectorUrl: string;
      automatic?: boolean;
      connectorName?: string;
    }): Promise<ConnectorSetupResult>;
  };
  /** Permission mode controls for tool execution. */
  permission?: {
    getMode(): PermissionMode;
    setMode(mode: PermissionMode): void | Promise<void>;
  };
  /** Session id persistence helpers. */
  session?: {
    getId(): string;
    setId(id: string): void | Promise<void>;
  };
  /** Optional status line metadata. */
  statusline?: {
    branch?: string;
    toolCallCount(): number;
  };
}

/** Slash command registration entry. */
export interface CommandDef {
  /** Primary command name without the leading slash. */
  name: string;
  /** Alternate names that invoke the same handler. */
  aliases?: string[];
  /** When true, hide from help output. */
  hidden?: boolean;
  /** Short description shown in help. */
  description: string;
  /** Async handler invoked with raw args and runtime context. */
  handler: (args: string, ctx: CommandContext) => Promise<void>;
}
