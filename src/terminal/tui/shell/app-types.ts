import type { TokenCounter } from "@/bridge/context-counter.ts";
import type { BridgeSettings } from "@/domain/bridge-types.ts";
import type { CommandSession } from "@/domain/command-types.ts";
import type { ModelOption } from "@/domain/connector-types.ts";
import type { Message } from "@/domain/message-types.ts";

export type PromptSendReport = "sent" | "queued";

export type PromptMode = "typing" | "command-list";

export interface AppProps {
  config: BridgeSettings;
  sendMessage: (message: string) => Promise<void>;
  clearMessages?: () => void;
  shutdown?: () => Promise<void>;
  messages: Message[];
  counter: TokenCounter;
  orchestrator: {
    listConversations(settings?: {
      readonly orphans?: boolean;
    }): Promise<Array<{ id: string; title: string; url: string }>>;
    searchConversations: CommandSession["orchestrator"]["searchConversations"];
    navigateToConversation(url: string): Promise<void>;
    openNewConversation(): Promise<void>;
    model: string;
    detectModel(): Promise<string>;
    listModels(): Promise<ModelOption[]>;
    switchModel(query: string): Promise<string>;
    rewindLastPrompt(replacement?: string): Promise<void>;
    stopReply(): Promise<boolean>;
    attachFiles?(paths: string[]): Promise<void>;
    openConnectorSetup?: CommandSession["orchestrator"]["openConnectorSetup"];
  };
  permissionMode?: string;
  sessionId?: string;
  branch?: string;
  toolCallCount?: number;
  permission?: CommandSession["permission"];
  session?: CommandSession["session"];
  statusline?: CommandSession["statusline"];
}
