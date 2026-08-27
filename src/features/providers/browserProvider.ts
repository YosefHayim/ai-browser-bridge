import type { Page } from "playwright";
import type {
  ConversationSearchInput,
  ConversationSearchResult,
} from "@/features/conversationCatalog";
import type { ConnectorSetupOptions, ConnectorSetupResult, ModelOption } from "@/features/domain";

// BridgeProviderId is derived from registry keys in providers.ts. Keep `id` a plain
// string here to avoid a type cycle (BrowserProvider → id → registry → BrowserProvider).

export type ResponseWaitOptions = {
  timeout?: number;
  previousAssistantCount?: number;
  previousLastAssistantText?: string;
  /** Generated images required before the turn counts as settled (ChatGPT only). */
  expectImages?: number;
};

export type CaptureMessagesOptions = {
  /** Root whose conversation folders hold attachment manifests. */
  manifestRoot?: string;
};

/** Browser automation surface shared by web provider adapters. */
export interface BrowserProvider {
  id: string;
  origin: string;
  defaultUrl: string;
  defaultModel: string;
  displayName: string;
  composerSelector: string;
  supportsMcpConnector: boolean;
  assertSignedIn(page: Page): Promise<void>;
  injectPrompt(page: Page, text: string): Promise<void>;
  waitForResponse(page: Page, waitOptions?: number | ResponseWaitOptions): Promise<void>;
  captureLastResponse(page: Page, captureOptions?: CaptureMessagesOptions): Promise<string>;
  countAssistantResponses(page: Page): Promise<number>;
  captureAllMessages(
    page: Page,
    captureOptions?: CaptureMessagesOptions,
  ): Promise<Array<{ role: string; content: string }>>;
  readSidebarConversations(
    page: Page,
    options?: { readonly orphans?: boolean },
  ): Promise<Array<{ id: string; title: string; url: string }>>;
  searchConversations?(
    page: Page,
    input: ConversationSearchInput,
  ): Promise<ConversationSearchResult[]>;
  navigateToConversation(page: Page, url: string): Promise<void>;
  newConversation(page: Page): Promise<void>;
  detectCurrentModel(page: Page): Promise<string>;
  listAvailableModels(page: Page): Promise<ModelOption[]>;
  selectModel(page: Page, query: string): Promise<string>;
  rewindLastUserPrompt(page: Page, replacement?: string): Promise<void>;
  stopGenerating(page: Page, timeout?: number): Promise<boolean>;
  attachFilesToPrompt(page: Page, paths: string[]): Promise<void>;
  isLikelyModelLabel(value: string): boolean;
  setupMcpConnector?(
    page: Page,
    url: string,
    setupOptions?: ConnectorSetupOptions,
  ): Promise<ConnectorSetupResult>;
}
