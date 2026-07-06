import type { ContextCounter } from "@/features/bridge";
import type { BridgeConfig, CommandContext, Message, ModelOption } from "@/features/domain";

/** Result of attempting to send or queue a prompt. */
export type PromptSendResult = "sent" | "queued";

/** Composer input mode for slash commands versus normal typing. */
export type InputMode = "typing" | "command-list";

/** Props for the terminal bridge Ink application. */
export interface AppProps {
  /** Bridge runtime configuration. */
  config: BridgeConfig;
  /** Sends a prompt to the remote ChatGPT session. */
  sendMessage: (content: string) => Promise<void>;
  /** Clears the local terminal message view. */
  clearMessages?: () => void;
  /** Shuts down the bridge process. */
  shutdown?: () => Promise<void>;
  /** Messages rendered in the terminal pane. */
  messages: Message[];
  /** Context window usage counter. */
  counter: ContextCounter;
  /** Browser orchestration helpers exposed to slash commands. */
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
  /** Fallback permission mode label when no live permission service exists. */
  permissionMode?: string;
  /** Fallback session id when no live session service exists. */
  sessionId?: string;
  /** Fallback git branch label when no statusline exists. */
  branch?: string;
  /** Fallback tool-call count when no statusline exists. */
  toolCallCount?: number;
  /** Optional permission service for slash commands. */
  permission?: CommandContext["permission"];
  /** Optional session service for slash commands. */
  session?: CommandContext["session"];
  /** Optional statusline provider for display metadata. */
  statusline?: CommandContext["statusline"];
}
