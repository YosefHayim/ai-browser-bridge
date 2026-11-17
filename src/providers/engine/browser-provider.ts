import { errors, type Locator } from "playwright";
import type {
  ConnectorSetupReport,
  ConnectorSetupSettings,
  ModelOption,
} from "@/connector-types.ts";
import type {
  ConversationSearchDetails,
  ConversationSearchReport,
} from "@/conversation-catalog/conversation-catalog-schemas.ts";

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

export type ProviderProfile = {
  readonly id: string;
  readonly origin: string;
  readonly defaultUrl: string;
  readonly defaultModel: string;
  readonly displayName: string;
  readonly composerSelector: string;
  readonly supportsMcpConnector: boolean;
};

export interface BrowserProvider {
  readonly profile: ProviderProfile;
  assertSignedIn(): Promise<void>;
  injectPrompt(prompt: string, settings?: InjectPromptSettings): Promise<void>;
  waitForReply(waitSettings?: number | ReplyWaitSettings): Promise<void>;
  captureLastReply(captureSettings?: CaptureMessagesSettings): Promise<string>;
  countAssistantReplies(): Promise<number>;
  captureAllMessages(
    captureSettings?: CaptureMessagesSettings,
  ): Promise<Array<{ role: string; content: string }>>;
  readSidebarConversations(settings?: {
    readonly orphans?: boolean;
  }): Promise<Array<{ id: string; title: string; url: string }>>;
  searchConversations?(request: ConversationSearchDetails): Promise<ConversationSearchReport[]>;
  navigateToConversation(url: string): Promise<void>;
  newConversation(): Promise<void>;
  detectCurrentModel(): Promise<string>;
  listAvailableModels(): Promise<ModelOption[]>;
  selectModel(query: string): Promise<string>;
  rewindLastUserPrompt(replacement?: string): Promise<void>;
  stopGenerating(timeout?: number): Promise<boolean>;
  attachFilesToPrompt(paths: string[]): Promise<void>;
  removeComposerAttachments?(): Promise<void>;
  isLikelyModelLabel(label: string): boolean;
  setupMcpConnector?(
    url: string,
    setupSettings?: ConnectorSetupSettings,
  ): Promise<ConnectorSetupReport>;
  // Turns the connector on in one chat's composer; does nothing when it is already on.
  turnOnConnectorInChat?(connectorName: string): Promise<void>;
}

// Playwright's innerText reads what the user sees, which is the text the selectors match.
export function readVisibleCopy(
  locator: Locator,
  timeoutSettings?: { timeout?: number },
): Promise<string> {
  // biome-ignore lint/performance/useDomNodeTextContent: Playwright innerText returns only the visible text
  return locator.innerText(timeoutSettings);
}

// A timeout means the element is not on the page, so nothing is logged; any other error is logged.
export function logUnlessElementMissing(error: unknown): void {
  const isElementMissing = error instanceof errors.TimeoutError;
  if (isElementMissing) return;

  console.error({ error });
}

// A best-effort read or click: a missing element returns the fallback; other errors are logged, then the fallback is returned.
export async function probeOrFallback<Value>(
  fallback: Value,
  probe: () => Promise<Value>,
): Promise<Value> {
  try {
    return await probe();
  } catch (error) {
    logUnlessElementMissing(error);
    return fallback;
  }
}
