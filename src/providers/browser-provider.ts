import type { Page } from "playwright";
import type {
  ConversationSearchDetails,
  ConversationSearchReport,
} from "@/conversation-catalog/conversation-catalog-schemas.ts";
import type {
  ConnectorSetupReport,
  ConnectorSetupSettings,
  ModelOption,
} from "@/domain/connector-types.ts";

// Plain string here, since a type through the provider registry would be a type cycle.

export type ReplyWaitSettings = {
  timeout?: number;
  previousAssistantCount?: number;
  previousLastAssistantText?: string;
  expectImages?: number;
};

export type CaptureMessagesSettings = {
  manifestRoot?: string;
};

export interface BrowserProvider {
  id: string;
  origin: string;
  defaultUrl: string;
  defaultModel: string;
  displayName: string;
  composerSelector: string;
  supportsMcpConnector: boolean;
  assertSignedIn(page: Page): Promise<void>;
  injectPrompt(page: Page, prompt: string): Promise<void>;
  waitForReply(page: Page, waitSettings?: number | ReplyWaitSettings): Promise<void>;
  captureLastReply(page: Page, captureSettings?: CaptureMessagesSettings): Promise<string>;
  countAssistantReplies(page: Page): Promise<number>;
  captureAllMessages(
    page: Page,
    captureSettings?: CaptureMessagesSettings,
  ): Promise<Array<{ role: string; content: string }>>;
  readSidebarConversations(
    page: Page,
    settings?: { readonly orphans?: boolean },
  ): Promise<Array<{ id: string; title: string; url: string }>>;
  searchConversations?(
    page: Page,
    request: ConversationSearchInput,
  ): Promise<ConversationSearchReport[]>;
  navigateToConversation(page: Page, url: string): Promise<void>;
  newConversation(page: Page): Promise<void>;
  detectCurrentModel(page: Page): Promise<string>;
  listAvailableModels(page: Page): Promise<ModelOption[]>;
  selectModel(page: Page, query: string): Promise<string>;
  rewindLastUserPrompt(page: Page, replacement?: string): Promise<void>;
  stopGenerating(page: Page, timeout?: number): Promise<boolean>;
  attachFilesToPrompt(page: Page, paths: string[]): Promise<void>;
  removeComposerAttachments?(page: Page): Promise<void>;
  isLikelyModelLabel(label: string): boolean;
  setupMcpConnector?(
    page: Page,
    url: string,
    setupSettings?: ConnectorSetupSettings,
  ): Promise<ConnectorSetupReport>;
}
