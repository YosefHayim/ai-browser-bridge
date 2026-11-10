import { errors, type Locator, type Page } from "playwright";
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

export type InjectPromptSettings = {
  // Runs after the prompt text is in the composer and before it is sent.
  beforeSend?: () => Promise<void>;
};

// The name the bridge plugin has in ChatGPT, and the name connector setup uses when none is given.
export const DEFAULT_CONNECTOR_NAME = "ai-browser-bridge";

export interface BrowserProvider {
  id: string;
  origin: string;
  defaultUrl: string;
  defaultModel: string;
  displayName: string;
  composerSelector: string;
  supportsMcpConnector: boolean;
  assertSignedIn(page: Page): Promise<void>;
  injectPrompt(page: Page, prompt: string, settings?: InjectPromptSettings): Promise<void>;
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
    request: ConversationSearchDetails,
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
  // Turns the connector on in one chat's composer; does nothing when it is already on.
  turnOnConnectorInChat?(page: Page, connectorName: string): Promise<void>;
}

// Playwright's innerText reads what the user sees, which is the text the selectors match.
export const readVisibleCopy = (
  locator: Locator,
  timeoutSettings?: { timeout?: number },
): Promise<string> =>
  // biome-ignore lint/performance/useDomNodeTextContent: Playwright's Locator.innerText, which reads only the visible text the selectors match
  locator.innerText(timeoutSettings);

// A timeout means the element is not on the page, so nothing is logged; any other error is logged.
export const logUnlessElementMissing = (error: unknown): void => {
  const isElementMissing = error instanceof errors.TimeoutError;
  if (isElementMissing) return;

  console.error({ error });
};

// A best-effort read or click: a missing element returns the fallback; other errors are logged, then the fallback is returned.
export const probeOrFallback = async <Value>(
  fallback: Value,
  probe: () => Promise<Value>,
): Promise<Value> => {
  try {
    return await probe();
  } catch (error) {
    logUnlessElementMissing(error);
    return fallback;
  }
};
