import type { Page } from "playwright";
import type { ConversationSearchReport } from "@/conversation-catalog/conversation-catalog-schemas.ts";
import { searchConversations } from "@/conversation-catalog/conversation-search.ts";
import type { BridgeSettings } from "@/domain/bridge-types.ts";
import type { ConnectorSetupReport, ModelOption } from "@/domain/connector-types.ts";
import type { Message, ToolReport } from "@/domain/message-types.ts";
import { findModelProfile } from "@/domain/model-lookup.ts";
import type { BrowserProvider } from "@/providers/browser-provider.ts";
import { isSameChatGptConversation } from "@/providers/chatgpt/chatgpt-conversation-url.ts";
import { readProvider } from "@/providers/providers.ts";

export type SendPromptDetails = {
  content: string;
  timeoutMs?: number;
  /** Number of generated images to wait for before the turn settles (ChatGPT only). */
  expectImages?: number;
};

export type ConnectorSetupDetails = {
  connectorUrl: string;
  automatic?: boolean;
  connectorName?: string;
};

export type OrchestratorSettings = {
  /** Optional root whose conversation folders hold attachment manifests. */
  manifestRoot?: string | undefined;
};

export type OrchestratorEvent =
  | { type: "message"; message: Message }
  | { type: "tool_call"; name: string; arguments: Record<string, unknown> }
  | { type: "tool_result"; name: string; result: ToolReport }
  | { type: "status"; text: string }
  | { type: "error"; error: string }
  | { type: "context_update"; count: number; limit: number }
  | { type: "conversation_synced"; messages: Message[] }
  | { type: "model_changed"; model: string; contextLimit: number }
  | { type: "reset" };

const requirePage = (page: Page | null, emit: (event: OrchestratorEvent) => void): Page | null => {
  const hasPage = page != null;
  if (hasPage) return page;

  emit({ type: "error", error: "Browser not connected." });
  return null;
};

const requirePageForPrompt = (
  page: Page | null,
  emit: (event: OrchestratorEvent) => void,
): Page | null => {
  const hasPage = page != null;
  if (hasPage) return page;

  emit({ type: "error", error: "Browser not connected. Cannot send prompt." });
  return null;
};

const readConversationMessage = (role: Message["role"], message: string): Message => {
  return { id: crypto.randomUUID(), role, content: message, timestamp: Date.now() };
};

const writeErrorString = (error: unknown): string => {
  const isErrorObject = error instanceof Error;
  if (isErrorObject) return error.message;

  return String(error);
};

const createOrchestratorEmitter = () => {
  const listenerRegistry = { listeners: [] as Array<(event: OrchestratorEvent) => void> };
  return {
    subscribe(listener: (event: OrchestratorEvent) => void) {
      listenerRegistry.listeners.push(listener);
      return () => {
        listenerRegistry.listeners = listenerRegistry.listeners.filter(
          (registered) => registered !== listener,
        );
      };
    },
    emit(event: OrchestratorEvent) {
      for (const listener of listenerRegistry.listeners) listener(event);
    },
  };
};

const listCapturedMessages = (captured: Array<{ role: string; content: string }>): Message[] => {
  return captured
    .filter(
      (message): message is { role: "user" | "assistant"; content: string } =>
        (message.role === "user" || message.role === "assistant") &&
        message.content.trim().length > 0,
    )
    .map((message) => ({
      id: `dom-${crypto.randomUUID()}`,
      role: message.role,
      content: message.content,
      timestamp: Date.now(),
    }));
};

const emitModelChanged = (emit: (event: OrchestratorEvent) => void, modelName: string): void => {
  const profile = findModelProfile(modelName);
  emit({ type: "model_changed", model: modelName, contextLimit: profile.contextWindow });
};

const emitModelDetected = (emit: (event: OrchestratorEvent) => void, modelName: string): void => {
  const profile = findModelProfile(modelName);
  emit({ type: "status", text: `Model: ${modelName}` });
  emit({ type: "model_changed", model: modelName, contextLimit: profile.contextWindow });
};

const detectModel = async (details: {
  page: Page | null;
  provider: BrowserProvider;
  modelName: string;
  emit: (event: OrchestratorEvent) => void;
}): Promise<string> => {
  if (details.page == null) return details.modelName;

  // The live provider read is authoritative — never fall back to a persisted label,
  // which can be another provider's model bleeding across a `--provider` switch.
  const detected = await details.provider.detectCurrentModel(details.page);
  emitModelDetected(details.emit, detected);
  return detected;
};

const applySelectedModel = (
  models: ModelOption[],
  emit: (event: OrchestratorEvent) => void,
): string | null => {
  const selected = models.find((model) => model.selected);

  const isSelectedMissing = selected == null;
  if (isSelectedMissing) return null;

  emitModelChanged(emit, selected.label);
  return selected.label;
};

const listModelsAction = async (details: {
  page: Page;
  provider: BrowserProvider;
  emit: (event: OrchestratorEvent) => void;
  setModelName: (name: string) => void;
}): Promise<ModelOption[]> => {
  const models = await details.provider.listAvailableModels(details.page);
  const selected = applySelectedModel(models, details.emit);

  const hasSelected = selected != null;
  if (hasSelected) details.setModelName(selected);

  return models;
};

const switchModelAction = async (details: {
  page: Page;
  provider: BrowserProvider;
  query: string;
  emit: (event: OrchestratorEvent) => void;
}): Promise<string> => {
  details.emit({ type: "status", text: `Switching model to ${details.query}...` });
  const modelName = await details.provider.selectModel(details.page, details.query);
  emitModelChanged(details.emit, modelName);
  details.emit({ type: "status", text: `Model: ${modelName}` });
  return modelName;
};

const syncConversationMessages = async (details: {
  page: Page | null;
  provider: BrowserProvider;
  emit: (event: OrchestratorEvent) => void;
  manifestRoot?: string | undefined;
}): Promise<Message[]> => {
  if (details.page == null) return [];

  const messages = listCapturedMessages(
    await details.provider.captureAllMessages(details.page, {
      manifestRoot: details.manifestRoot,
    }),
  );

  const isMessagesEmpty = messages.length === 0;
  if (isMessagesEmpty) return [];

  details.emit({ type: "conversation_synced", messages });
  return messages;
};

const createNavigateToConversationAction = async (details: {
  page: Page;
  provider: BrowserProvider;
  emit: (event: OrchestratorEvent) => void;
  url: string;
  manifestRoot?: string | undefined;
}): Promise<Message[]> => {
  details.emit({ type: "status", text: "Navigating to conversation..." });
  await details.provider.navigateToConversation(details.page, details.url);
  const messages = await syncConversationMessages(details);
  details.emit({ type: "status", text: "Ready" });
  return messages;
};

const startNewConversationOnPage = async (details: {
  page: Page;
  provider: BrowserProvider;
  emit: (event: OrchestratorEvent) => void;
}): Promise<void> => {
  details.emit({ type: "status", text: "Starting new conversation..." });
  await details.provider.newConversation(details.page);
  details.emit({ type: "reset" });
  details.emit({ type: "status", text: "Ready — new conversation" });
};

const createRewindLastPromptAction = async (details: {
  page: Page;
  provider: BrowserProvider;
  emit: (event: OrchestratorEvent) => void;
  replacement?: string;
  manifestRoot?: string | undefined;
}): Promise<Message[]> => {
  details.emit({ type: "status", text: "Rewinding last prompt..." });
  await details.provider.rewindLastUserPrompt(details.page, details.replacement);
  const messages = await syncConversationMessages(details);
  details.emit({ type: "status", text: "Ready — rewound last prompt" });
  return messages;
};

const attachFilesAction = async (details: {
  page: Page;
  provider: BrowserProvider;
  paths: string[];
  emit: (event: OrchestratorEvent) => void;
}): Promise<void> => {
  await details.provider.removeComposerAttachments?.(details.page);

  const isThereNoFileToAttach = details.paths.length === 0;
  if (isThereNoFileToAttach) return;

  details.emit({ type: "status", text: "Attaching files..." });
  await details.provider.attachFilesToPrompt(details.page, details.paths);
  details.emit({ type: "status", text: "Files attached." });
};

const stopReplyAction = async (details: {
  page: Page;
  provider: BrowserProvider;
  emit: (event: OrchestratorEvent) => void;
}): Promise<boolean> => {
  const stopped = await details.provider.stopGenerating(details.page);
  if (stopped) {
    details.emit({ type: "status", text: "Stopped response." });
  } else {
    details.emit({ type: "status", text: "No active response to stop." });
  }

  return stopped;
};

const executeSendPrompt = async (
  details: SendPromptDetails & {
    page: Page | null;
    provider: BrowserProvider;
    emit: (event: OrchestratorEvent) => void;
    pushMessage: (message: Message) => void;
    manifestRoot?: string | undefined;
  },
): Promise<Message | null> => {
  const userMessage = readConversationMessage("user", details.content);
  details.pushMessage(userMessage);
  details.emit({ type: "message", message: userMessage });
  details.emit({ type: "status", text: `Waiting for ${details.provider.displayName}...` });
  const page = requirePageForPrompt(details.page, details.emit);

  const isPageMissing = page == null;
  if (isPageMissing) return null;

  try {
    const previousAssistantCount = await input.provider.countAssistantReplies(page);
    const previousLastAssistantText = await input.provider.captureLastReply(page, {
      manifestRoot: input.manifestRoot,
    });
    await input.provider.injectPrompt(page, input.content);
    input.emit({ type: "status", text: `${input.provider.displayName} is responding...` });
    await input.provider.waitForReply(page, {
      previousAssistantCount,
      previousLastAssistantText: previousLastAssistantString,
      timeout: details.timeoutMs,
      expectImages: details.expectImages,
    });
    const assistantText = await input.provider.captureLastReply(page, {
      manifestRoot: input.manifestRoot,
    });
    const assistantMessage = readConversationMessage("assistant", assistantString);
    details.pushMessage(assistantMessage);
    details.emit({ type: "message", message: assistantMessage });
    details.emit({ type: "status", text: "Ready" });
    return assistantMessage;
  } catch (error) {
    const errorString = writeErrorString(error);
    details.emit({ type: "error", error: errorString });
    return null;
  }
};

const openConnectorSetup = async (
  details: ConnectorSetupDetails & {
    page: Page | null;
    provider: BrowserProvider;
    emit: (event: OrchestratorEvent) => void;
  },
): Promise<ConnectorSetupReport> => {
  if (
    details.provider.supportsMcpConnector !== true ||
    details.provider.setupMcpConnector == null
  ) {
    details.emit({ type: "status", text: "Connector setup is not available for this provider." });
    return {
      connectorUrl: details.connectorUrl,
      completed: false,
      steps: [],
      warnings: [
        `${details.provider.displayName} web does not support custom MCP connectors.`,
        "Use @file mentions for read-only repo context, or switch to ChatGPT, Claude, or Grok for full MCP tools.",
      ],
    };
  }

  if (details.page == null) {
    details.emit({ type: "error", error: "Browser not connected." });
    return {
      connectorUrl: details.connectorUrl,
      completed: false,
      steps: [],
      warnings: [
        `Browser not connected. Open ${details.provider.displayName} settings manually and add the connector URL.`,
      ],
    };
  }

  const isAutomatic = details.automatic === true;
  if (isAutomatic) {
    details.emit({
      type: "status",
      text: `Syncing ${details.provider.displayName} connector...`,
    });
  } else {
    details.emit({
      type: "status",
      text: `Opening ${details.provider.displayName} connector setup...`,
    });
  }

  const connectorSetup = await details.provider.setupMcpConnector(
    details.page,
    details.connectorUrl,
    {
      automatic: details.automatic,
      connectorName: details.connectorName,
    },
  );
  if (connectorSetup.completed) {
    details.emit({ type: "status", text: "Connector ready." });
  } else {
    details.emit({ type: "status", text: "Connector setup needs manual finish." });
  }

  return connectorSetup;
};

export class Orchestrator {
  private readonly emitter = createOrchestratorEmitter();
  private messages: Message[] = [];
  private page: Page | null = null;
  private readonly provider: BrowserProvider;
  private readonly manifestRoot: string | undefined;
  private modelName: string;

  constructor(
    settings: BridgeSettings,
    provider?: BrowserProvider,
    orchestratorSettings: OrchestratorSettings = {},
  ) {
    const hasProvider = provider != null;
    if (hasProvider) {
      this.provider = provider;
    } else {
      this.provider = readProvider(settings.provider);
    }

    this.manifestRoot = orchestratorSettings.manifestRoot;

    if (settings.model != null) {
      this.modelName = settings.model;
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
    void Promise.allSettled([this.detectModel()]);
  }

  subscribe(listener: (event: OrchestratorEvent) => void): () => void {
    return this.emitter.subscribe(listener);
  }

  private emit(event: OrchestratorEvent): void {
    this.emitter.emit(event);
  }

  async detectModel(): Promise<string> {
    this.modelName = await detectModel({
      page: this.page,
      provider: this.provider,
      modelName: this.modelName,
      emit: this.emit.bind(this),
    });
    return this.modelName;
  }

  async start(): Promise<void> {
    this.messages = await syncConversationMessages({
      page: this.page,
      provider: this.provider,
      emit: this.emit.bind(this),
      manifestRoot: this.manifestRoot,
    });
    void Promise.allSettled([this.detectModel()]);
    this.emit({ type: "status", text: "Bridge ready. Type a prompt to begin." });
  }

  async sendPrompt(details: SendPromptDetails): Promise<Message | null> {
    return executeSendPrompt({
      ...details,
      page: this.page,
      provider: this.provider,
      emit: this.emit.bind(this),
      manifestRoot: this.manifestRoot,
      pushMessage: (message) => {
        this.messages.push(message);
      },
    });
  }

  async listConversations(settings?: { readonly orphans?: boolean }) {
    const isOrphanScanWithoutPage = this.page == null && settings?.orphans === true;
    if (isOrphanScanWithoutPage) throw new Error("No ChatGPT page is open to read loose chats.");

    if (this.page == null) return [];

    return this.provider.readSidebarConversations(this.page, settings);
  }

  async searchConversations(details: {
    query: string;
    limit?: number;
  }): Promise<ConversationSearchReport[]> {
    if (this.page == null) return [];

    return searchConversations({
      page: this.page,
      provider: this.provider,
      query: details.query,
      limit: details.limit,
    });
  }

  async listModels(): Promise<ModelOption[]> {
    const boundEmit = this.emit.bind(this);
    const page = requirePage(this.page, boundEmit);

    const isPageMissing = page == null;
    if (isPageMissing) return [];

    return listModelsAction({
      page,
      provider: this.provider,
      emit: this.emit.bind(this),
      setModelName: (name) => {
        this.modelName = name;
      },
    });
  }

  async switchModel(query: string): Promise<string> {
    const boundEmit = this.emit.bind(this);
    const page = requirePage(this.page, boundEmit);

    const isPageMissing = page == null;
    if (isPageMissing) return this.modelName;

    this.modelName = await switchModelAction({
      page,
      provider: this.provider,
      query,
      emit: this.emit.bind(this),
    });
    return this.modelName;
  }

  async navigateToConversation(url: string): Promise<void> {
    const boundEmit = this.emit.bind(this);
    const page = requirePage(this.page, boundEmit);

    const isPageMissing = page == null;
    if (isPageMissing) return;

    if (isSameChatGptConversation(page.url(), url)) return;

    this.messages = await createNavigateToConversationAction({
      page,
      provider: this.provider,
      emit: this.emit.bind(this),
      url,
      manifestRoot: this.manifestRoot,
    });
  }

  async openNewConversation(): Promise<void> {
    const boundEmit = this.emit.bind(this);
    const page = requirePage(this.page, boundEmit);

    const isPageMissing = page == null;
    if (isPageMissing) return;

    await startNewConversationOnPage({ page, provider: this.provider, emit: this.emit.bind(this) });
    this.messages = [];
  }

  async rewindLastPrompt(replacement?: string): Promise<void> {
    const boundEmit = this.emit.bind(this);
    const page = requirePage(this.page, boundEmit);

    const isPageMissing = page == null;
    if (isPageMissing) return;

    this.messages = await createRewindLastPromptAction({
      page,
      provider: this.provider,
      emit: this.emit.bind(this),
      replacement,
      manifestRoot: this.manifestRoot,
    });
  }

  async stopReply(): Promise<boolean> {
    const boundEmit = this.emit.bind(this);
    const page = requirePage(this.page, boundEmit);

    const isPageMissing = page == null;
    if (isPageMissing) return false;

    return stopReplyAction({ page, provider: this.provider, emit: this.emit.bind(this) });
  }

  async attachFiles(paths: string[]): Promise<void> {
    const boundEmit = this.emit.bind(this);
    const page = requirePage(this.page, boundEmit);

    const isPageMissing = page == null;
    if (isPageMissing) return;

    await attachFilesAction({ page, provider: this.provider, paths, emit: this.emit.bind(this) });
  }

  async openConnectorSetup(details: ConnectorSetupDetails): Promise<ConnectorSetupReport> {
    return openConnectorSetup({
      ...details,
      page: this.page,
      provider: this.provider,
      emit: this.emit.bind(this),
    });
  }

  async stop(): Promise<void> {
    this.emit({ type: "status", text: "Shutting down..." });
  }
}
