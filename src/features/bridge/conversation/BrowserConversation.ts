import type { Page } from "playwright";
import type { ConversationSearchResult } from "@/features/conversations/conversationCatalogSchemas.ts";
import { searchConversations } from "@/features/conversations/conversationSearch.ts";
import type { Message } from "@/features/conversations/conversationTypes.ts";
import { findModelProfile } from "@/features/models/modelLookup.ts";
import type { RepoToolResult } from "@/features/repoMcp/toolDefinition.ts";
import type { BrowserProvider } from "@/features/webProviders/browserProvider.ts";
import { isSameChatGptConversation } from "@/features/webProviders/chatgpt/chatgptConversationUrl.ts";
import type {
  ConnectorSetupResult,
  ModelOption,
} from "@/features/webProviders/connectors/connectorTypes.ts";
import { webProviderFor } from "@/features/webProviders/providerRegistry.ts";
import type { BridgeConfig } from "../engine/bridgeEngineTypes.ts";

export type SendPromptInput = {
  content: string;
  timeoutMs?: number;
  /** Number of generated images to wait for before the turn settles (ChatGPT only). */
  expectImages?: number;
};

export type ConnectorSetupInput = {
  connectorUrl: string;
  automatic?: boolean;
  connectorName?: string;
};

export type BrowserConversationOptions = {
  /** Optional root whose conversation folders hold attachment manifests. */
  manifestRoot?: string | undefined;
};

export type BrowserConversationEvent =
  | { type: "message"; message: Message }
  | { type: "tool_call"; name: string; arguments: Record<string, unknown> }
  | { type: "tool_result"; name: string; result: RepoToolResult }
  | { type: "status"; text: string }
  | { type: "error"; error: string }
  | { type: "context_update"; count: number; limit: number }
  | { type: "conversation_synced"; messages: Message[] }
  | { type: "model_changed"; model: string; contextLimit: number }
  | { type: "reset" };

export type BrowserConversationListener = (event: BrowserConversationEvent) => void;

const conversationMessage = (role: Message["role"], content: string): Message => {
  return { id: crypto.randomUUID(), role, content, timestamp: Date.now() };
};

export class BrowserConversation {
  private listeners: BrowserConversationListener[] = [];
  private messages: Message[] = [];
  private page: Page | null = null;
  private readonly provider: BrowserProvider;
  private readonly manifestRoot: string | undefined;
  private modelName: string;

  constructor(
    config: BridgeConfig,
    provider?: BrowserProvider,
    options: BrowserConversationOptions = {},
  ) {
    if (provider !== undefined) {
      this.provider = provider;
    } else {
      this.provider = webProviderFor(config.provider);
    }
    this.manifestRoot = options.manifestRoot;
    if (config.model !== undefined) {
      this.modelName = config.model;
    } else {
      this.modelName = this.provider.defaultModel;
    }
  }

  get browserProvider(): BrowserProvider {
    return this.provider;
  }
  get model(): string {
    return this.modelName;
  }
  get currentMessages(): Message[] {
    return this.messages;
  }

  setPage(page: Page): void {
    this.page = page;
    const modelDetection = this.detectModel();
    void Promise.allSettled([modelDetection]);
  }

  on(listener: BrowserConversationListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(
        (registeredListener) => registeredListener !== listener,
      );
    };
  }

  private emit(event: BrowserConversationEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private connectedPage(): Page | null {
    if (this.page !== null) return this.page;
    this.emit({ type: "error", error: "Browser not connected." });
    return null;
  }

  private modelChanged(modelName: string): void {
    const modelProfile = findModelProfile(modelName);
    this.emit({
      type: "model_changed",
      model: modelName,
      contextLimit: modelProfile.contextWindow,
    });
  }

  async detectModel(): Promise<string> {
    if (this.page === null) return this.modelName;
    // The live provider read is authoritative; persisted labels can belong to a different provider.
    const detectedModel = await this.provider.detectCurrentModel(this.page);
    this.emit({ type: "status", text: `Model: ${detectedModel}` });
    this.modelChanged(detectedModel);
    this.modelName = detectedModel;
    return detectedModel;
  }

  private async captureMessages(): Promise<Message[]> {
    if (this.page === null) return [];
    const capturedMessages = await this.provider.captureAllMessages(this.page, {
      manifestRoot: this.manifestRoot,
    });
    const conversationMessages: Message[] = [];
    for (const capturedMessage of capturedMessages) {
      if (capturedMessage.role !== "user" && capturedMessage.role !== "assistant") continue;
      const messageText = capturedMessage.content.trim();
      if (messageText.length === 0) continue;
      conversationMessages.push({
        id: `dom-${crypto.randomUUID()}`,
        role: capturedMessage.role,
        content: capturedMessage.content,
        timestamp: Date.now(),
      });
    }
    if (conversationMessages.length > 0) {
      this.emit({ type: "conversation_synced", messages: conversationMessages });
    }
    return conversationMessages;
  }

  async start(): Promise<void> {
    this.messages = await this.captureMessages();
    const modelDetection = this.detectModel();
    void Promise.allSettled([modelDetection]);
    this.emit({ type: "status", text: "Bridge ready. Type a prompt to begin." });
  }

  async sendPrompt(prompt: SendPromptInput): Promise<Message | null> {
    const userMessage = conversationMessage("user", prompt.content);
    this.messages.push(userMessage);
    this.emit({ type: "message", message: userMessage });
    this.emit({ type: "status", text: `Waiting for ${this.provider.displayName}...` });
    const page = this.page;
    if (page === null) {
      this.emit({ type: "error", error: "Browser not connected. Cannot send prompt." });
      return null;
    }
    try {
      const previousAssistantCount = await this.provider.countAssistantResponses(page);
      const previousLastAssistantText = await this.provider.captureLastResponse(page, {
        manifestRoot: this.manifestRoot,
      });
      await this.provider.injectPrompt(page, prompt.content);
      this.emit({ type: "status", text: `${this.provider.displayName} is responding...` });
      await this.provider.waitForResponse(page, {
        previousAssistantCount,
        previousLastAssistantText,
        timeout: prompt.timeoutMs,
        expectImages: prompt.expectImages,
      });
      const assistantText = await this.provider.captureLastResponse(page, {
        manifestRoot: this.manifestRoot,
      });
      const assistantMessage = conversationMessage("assistant", assistantText);
      this.messages.push(assistantMessage);
      this.emit({ type: "message", message: assistantMessage });
      this.emit({ type: "status", text: "Ready" });
      return assistantMessage;
    } catch (promptError) {
      let errorMessage: string;
      if (promptError instanceof Error) {
        errorMessage = promptError.message;
      } else {
        errorMessage = String(promptError);
      }
      this.emit({ type: "error", error: errorMessage });
      return null;
    }
  }

  async listConversations(options?: { readonly orphans?: boolean }) {
    if (this.page === null) return [];
    return this.provider.readSidebarConversations(this.page, options);
  }

  async searchConversations(search: {
    query: string;
    limit?: number;
  }): Promise<ConversationSearchResult[]> {
    if (this.page === null) return [];
    return searchConversations({
      page: this.page,
      provider: this.provider,
      query: search.query,
      limit: search.limit,
    });
  }

  async listModels(): Promise<ModelOption[]> {
    const page = this.connectedPage();
    if (page === null) return [];
    const availableModels = await this.provider.listAvailableModels(page);
    const selectedModel = availableModels.find((model) => model.selected);
    if (selectedModel !== undefined) {
      this.modelChanged(selectedModel.label);
      this.modelName = selectedModel.label;
    }
    return availableModels;
  }

  async switchModel(query: string): Promise<string> {
    const page = this.connectedPage();
    if (page === null) return this.modelName;
    this.emit({ type: "status", text: `Switching model to ${query}...` });
    const selectedModel = await this.provider.selectModel(page, query);
    this.modelChanged(selectedModel);
    this.emit({ type: "status", text: `Model: ${selectedModel}` });
    this.modelName = selectedModel;
    return selectedModel;
  }

  async navigateToConversation(url: string): Promise<void> {
    const page = this.connectedPage();
    if (page === null) return;
    const currentUrl = page.url();
    if (isSameChatGptConversation(currentUrl, url)) return;
    this.emit({ type: "status", text: "Navigating to conversation..." });
    await this.provider.navigateToConversation(page, url);
    this.messages = await this.captureMessages();
    this.emit({ type: "status", text: "Ready" });
  }

  async newConversation(): Promise<void> {
    const page = this.connectedPage();
    if (page === null) return;
    this.emit({ type: "status", text: "Starting new conversation..." });
    await this.provider.newConversation(page);
    this.emit({ type: "reset" });
    this.emit({ type: "status", text: "Ready — new conversation" });
    this.messages = [];
  }

  async rewindLastPrompt(replacement?: string): Promise<void> {
    const page = this.connectedPage();
    if (page === null) return;
    this.emit({ type: "status", text: "Rewinding last prompt..." });
    await this.provider.rewindLastUserPrompt(page, replacement);
    this.messages = await this.captureMessages();
    this.emit({ type: "status", text: "Ready — rewound last prompt" });
  }

  async stopResponse(): Promise<boolean> {
    const page = this.connectedPage();
    if (page === null) return false;
    const stopped = await this.provider.stopGenerating(page);
    if (stopped) {
      this.emit({ type: "status", text: "Stopped response." });
    } else {
      this.emit({ type: "status", text: "No active response to stop." });
    }
    return stopped;
  }

  async attachFiles(paths: string[]): Promise<void> {
    const page = this.connectedPage();
    if (page === null) return;
    this.emit({ type: "status", text: "Attaching files..." });
    await this.provider.attachFilesToPrompt(page, paths);
    this.emit({ type: "status", text: "Files attached." });
  }

  async openConnectorSetup(connectorRequest: ConnectorSetupInput): Promise<ConnectorSetupResult> {
    if (
      this.provider.supportsMcpConnector !== true ||
      this.provider.setupMcpConnector === undefined
    ) {
      this.emit({ type: "status", text: "Connector setup is not available for this provider." });
      return {
        connectorUrl: connectorRequest.connectorUrl,
        completed: false,
        steps: [],
        warnings: [
          `${this.provider.displayName} web does not support custom MCP connectors.`,
          "Use @file mentions for read-only repo context, or switch to ChatGPT, Claude, or Grok for full MCP tools.",
        ],
      };
    }
    if (this.page === null) {
      this.emit({ type: "error", error: "Browser not connected." });
      return {
        connectorUrl: connectorRequest.connectorUrl,
        completed: false,
        steps: [],
        warnings: [
          `Browser not connected. Open ${this.provider.displayName} settings manually and add the connector URL.`,
        ],
      };
    }
    if (connectorRequest.automatic === true) {
      this.emit({
        type: "status",
        text: `Syncing ${this.provider.displayName} connector...`,
      });
    } else {
      this.emit({
        type: "status",
        text: `Opening ${this.provider.displayName} connector setup...`,
      });
    }
    const connectorSetup = await this.provider.setupMcpConnector(
      this.page,
      connectorRequest.connectorUrl,
      {
        automatic: connectorRequest.automatic,
        connectorName: connectorRequest.connectorName,
      },
    );
    if (connectorSetup.completed) {
      this.emit({ type: "status", text: "Connector ready." });
    } else {
      this.emit({ type: "status", text: "Connector setup needs manual finish." });
    }
    return connectorSetup;
  }

  async stop(): Promise<void> {
    this.emit({ type: "status", text: "Shutting down..." });
  }
}
