import type { ContextCounter } from "@/features/bridge";
import type { BridgeConfig, CommandContext, Message, ModelOption } from "@/features/domain";

export type PromptSendResult = "sent" | "queued";

export type InputMode = "typing" | "command-list";

export interface AppProps {
  config: BridgeConfig;
  sendMessage: (content: string) => Promise<void>;
  clearMessages?: () => void;
  shutdown?: () => Promise<void>;
  messages: Message[];
  counter: ContextCounter;
  orchestrator: {
    listConversations(): Promise<Array<{ id: string; title: string; url: string }>>;
    searchConversations: CommandContext["orchestrator"]["searchConversations"];
    navigateToConversation(url: string): Promise<void>;
    newConversation(): Promise<void>;
    model: string;
    detectModel(): Promise<string>;
    listModels(): Promise<ModelOption[]>;
    switchModel(query: string): Promise<string>;
    rewindLastPrompt(replacement?: string): Promise<void>;
    stopResponse(): Promise<boolean>;
    attachFiles?(paths: string[]): Promise<void>;
    openConnectorSetup?: CommandContext["orchestrator"]["openConnectorSetup"];
  };
  /** Permission mode label when no live permission service is wired. */
  permissionMode?: string;
  /** Session id when no live session service is wired. */
  sessionId?: string;
  /** Git branch label when no statusline is wired. */
  branch?: string;
  /** Tool-call count when no statusline is wired. */
  toolCallCount?: number;
  permission?: CommandContext["permission"];
  session?: CommandContext["session"];
  statusline?: CommandContext["statusline"];
}
