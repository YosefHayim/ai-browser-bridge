import type {
  ConversationSearchInput,
  ConversationSearchResult,
} from "@/features/conversationCatalog";
import type { ConnectorSetupOptions, ConnectorSetupResult, ModelOption } from "@/features/domain";
import type { Page } from "playwright";

// The provider id union (BridgeProviderId) is derived from the registry keys in
// providerRegistry.ts — the single source of truth. Keep `id` a plain string here to
// avoid a type cycle (BrowserProvider → id → registry → BrowserProvider).

/** Options for waiting on an assistant response in the browser. */
export interface ResponseWaitOptions {
  /** Maximum wait time in milliseconds. */
  timeout?: number;
  /** Assistant message count before the prompt was sent. */
  previousAssistantCount?: number;
  /** Last assistant text before the prompt was sent. */
  previousLastAssistantText?: string;
  /** Number of generated images to wait for before the turn counts as settled (ChatGPT only). */
  expectImages?: number;
}

/** Options for capturing provider messages from the browser DOM. */
export interface CaptureMessagesOptions {
  /** Optional root whose conversation folders hold attachment manifests. */
  manifestRoot?: string | undefined;
}

/** Browser automation surface shared by ChatGPT and Gemini web adapters. */
export interface BrowserProvider {
  /** Provider identifier used in config and CLI (a registry key). */
  id: string;
  /** Origin hostname used to locate an existing tab. */
  origin: string;
  /** Default URL opened when no provider tab exists. */
  defaultUrl: string;
  /** Fallback model label before detection runs. */
  defaultModel: string;
  /** Human-readable provider name for logs. */
  displayName: string;
  /** Composer selector waited on after navigation. */
  composerSelector: string;
  /** Whether MCP connector setup is supported. */
  supportsMcpConnector: boolean;
  assertSignedIn(page: Page): Promise<void>;
  injectPrompt(page: Page, text: string): Promise<void>;
  waitForResponse(page: Page, options?: number | ResponseWaitOptions): Promise<void>;
  captureLastResponse(page: Page, options?: CaptureMessagesOptions): Promise<string>;
  countAssistantResponses(page: Page): Promise<number>;
  captureAllMessages(
    page: Page,
    options?: CaptureMessagesOptions,
  ): Promise<Array<{ role: string; content: string }>>;
  readSidebarConversations(page: Page): Promise<Array<{ id: string; title: string; url: string }>>;
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
    options?: ConnectorSetupOptions,
  ): Promise<ConnectorSetupResult>;
}
