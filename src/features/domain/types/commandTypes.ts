import type { PermissionMode } from "../permissions.ts";
import type { BridgeConfig } from "./bridgeTypes.ts";
import type { ConnectorSetupResult, ModelOption } from "./connectorTypes.ts";
import type { Message } from "./messageTypes.ts";

/** Runtime context passed to slash command handlers. */
export type CommandContext = {
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
    searchConversations(input: {
      query: string;
      limit?: number;
    }): Promise<Array<{ id: string; title: string; url: string; source: string; score: number }>>;
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
  permission?: {
    getMode(): PermissionMode;
    setMode(mode: PermissionMode): void | Promise<void>;
  };
  session?: {
    getId(): string;
    setId(id: string): void | Promise<void>;
  };
  statusline?: {
    branch?: string;
    toolCallCount(): number;
  };
};

/** Slash command registration entry. */
export type CommandDef = {
  name: string;
  aliases?: string[];
  hidden?: boolean;
  description: string;
  handler: (args: string, ctx: CommandContext) => Promise<void>;
};
