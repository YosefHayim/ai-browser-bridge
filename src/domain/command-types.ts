import type { Page } from "playwright";
import type { BridgeSettings } from "./bridge-types.ts";
import type { ConnectorSetupReport, ModelOption } from "./connector-types.ts";
import type { Message } from "./message-types.ts";
import type { PermissionMode } from "./permissions.ts";

export type CommandSession = {
  config: BridgeSettings;
  messages: Message[];
  sendMessage: (message: string) => Promise<void>;
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
    listConversations(settings?: {
      readonly orphans?: boolean;
    }): Promise<Array<{ id: string; title: string; url: string }>>;
    searchConversations(details: {
      query: string;
      limit?: number;
    }): Promise<Array<{ id: string; title: string; url: string; source: string; score: number }>>;
    navigateToConversation(url: string): Promise<void>;
    openNewConversation(): Promise<void>;
    model: string;
    page: Page | null;
    detectModel(): Promise<string>;
    listModels(): Promise<ModelOption[]>;
    switchModel(query: string): Promise<string>;
    rewindLastPrompt(replacement?: string): Promise<void>;
    stopReply(): Promise<boolean>;
    attachFiles?(paths: string[]): Promise<void>;
    openConnectorSetup?(details: {
      connectorUrl: string;
      automatic?: boolean;
      connectorName?: string;
    }): Promise<ConnectorSetupReport>;
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

export type CommandDef = {
  name: string;
  aliases?: string[];
  hidden?: boolean;
  description: string;
  handler: (argumentList: string, session: CommandSession) => Promise<void>;
};
