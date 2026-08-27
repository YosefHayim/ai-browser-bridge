import type { Page } from "playwright";
import type { ConversationSearchResult } from "@/features/conversationCatalog";
import { searchConversations } from "@/features/conversationCatalog";
import type {
  BridgeConfig,
  ConnectorSetupResult,
  Message,
  ModelOption,
  ToolResult,
} from "@/features/domain";
import { findModelProfile } from "@/features/domain";
import { type BrowserProvider, isSameChatGptConversation, providerFor } from "@/features/providers";

export type SendPromptOptions = {
  timeoutMs?: number;
};

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

export type OrchestratorOptions = {
  /** Optional root whose conversation folders hold attachment manifests. */
  manifestRoot?: string | undefined;
};

export type OrchestratorEvent =
  | { type: "message"; message: Message }
  | { type: "tool_call"; name: string; arguments: Record<string, unknown> }
  | { type: "tool_result"; name: string; result: ToolResult }
  | { type: "status"; text: string }
  | { type: "error"; error: string }
  | { type: "context_update"; count: number; limit: number }
  | { type: "conversation_synced"; messages: Message[] }
  | { type: "model_changed"; model: string; contextLimit: number }
  | { type: "reset" };

export type OrchestratorListener = (event: OrchestratorEvent) => void;

const requirePage = (page: Page | null, emit: (event: OrchestratorEvent) => void): Page | null => {
  if (page !== null) return page;
  emit({ type: "error", error: "Browser not connected." });
  return null;
};

const requirePageForPrompt = (
  page: Page | null,
  emit: (event: OrchestratorEvent) => void,
): Page | null => {
  if (page !== null) return page;
  emit({ type: "error", error: "Browser not connected. Cannot send prompt." });
  return null;
};

const conversationMessage = (role: Message["role"], content: string): Message => {
  return { id: crypto.randomUUID(), role, content, timestamp: Date.now() };
};

const formatError = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return String(error);
};

const orchestratorEmitter = () => {
  const state = { listeners: [] as Array<(event: OrchestratorEvent) => void> };
  return {
    on(listener: (event: OrchestratorEvent) => void) {
      state.listeners.push(listener);
      return () => {
        state.listeners = state.listeners.filter((registered) => registered !== listener);
      };
    },
    emit(event: OrchestratorEvent) {
      for (const listener of state.listeners) listener(event);
    },
  };
};

const mapCapturedMessages = (captured: Array<{ role: string; content: string }>): Message[] => {
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

const detectModel = async (input: {
  page: Page | null;
  provider: BrowserProvider;
  modelName: string;
  emit: (event: OrchestratorEvent) => void;
}): Promise<string> => {
  if (input.page === null) return input.modelName;
  // The live provider read is authoritative — never fall back to a persisted label,
  // which can be another provider's model bleeding across a `--provider` switch.
  const detected = await input.provider.detectCurrentModel(input.page);
  emitModelDetected(input.emit, detected);
  return detected;
};

const applySelectedModel = (
  models: ModelOption[],
  emit: (event: OrchestratorEvent) => void,
): string | null => {
  const selected = models.find((model) => model.selected);
  if (selected === undefined) return null;
  emitModelChanged(emit, selected.label);
  return selected.label;
};

const listModelsAction = async (input: {
  page: Page;
  provider: BrowserProvider;
  emit: (event: OrchestratorEvent) => void;
  setModelName: (name: string) => void;
}): Promise<ModelOption[]> => {
  const models = await input.provider.listAvailableModels(input.page);
  const selected = applySelectedModel(models, input.emit);
  if (selected !== null) input.setModelName(selected);
  return models;
};

const switchModelAction = async (input: {
  page: Page;
  provider: BrowserProvider;
  query: string;
  emit: (event: OrchestratorEvent) => void;
}): Promise<string> => {
  input.emit({ type: "status", text: `Switching model to ${input.query}...` });
  const modelName = await input.provider.selectModel(input.page, input.query);
  emitModelChanged(input.emit, modelName);
  input.emit({ type: "status", text: `Model: ${modelName}` });
  return modelName;
};

const syncConversationMessages = async (input: {
  page: Page | null;
  provider: BrowserProvider;
  emit: (event: OrchestratorEvent) => void;
  manifestRoot?: string | undefined;
}): Promise<Message[]> => {
  if (input.page === null) return [];
  const messages = mapCapturedMessages(
    await input.provider.captureAllMessages(input.page, {
      manifestRoot: input.manifestRoot,
    }),
  );
  if (messages.length === 0) return [];
  input.emit({ type: "conversation_synced", messages });
  return messages;
};

const navigateToConversationAction = async (input: {
  page: Page;
  provider: BrowserProvider;
  emit: (event: OrchestratorEvent) => void;
  url: string;
  manifestRoot?: string | undefined;
}): Promise<Message[]> => {
  input.emit({ type: "status", text: "Navigating to conversation..." });
  await input.provider.navigateToConversation(input.page, input.url);
  const messages = await syncConversationMessages(input);
  input.emit({ type: "status", text: "Ready" });
  return messages;
};

const newConversationAction = async (input: {
  page: Page;
  provider: BrowserProvider;
  emit: (event: OrchestratorEvent) => void;
}): Promise<void> => {
  input.emit({ type: "status", text: "Starting new conversation..." });
  await input.provider.newConversation(input.page);
  input.emit({ type: "reset" });
  input.emit({ type: "status", text: "Ready — new conversation" });
};

const rewindLastPromptAction = async (input: {
  page: Page;
  provider: BrowserProvider;
  emit: (event: OrchestratorEvent) => void;
  replacement?: string;
  manifestRoot?: string | undefined;
}): Promise<Message[]> => {
  input.emit({ type: "status", text: "Rewinding last prompt..." });
  await input.provider.rewindLastUserPrompt(input.page, input.replacement);
  const messages = await syncConversationMessages(input);
  input.emit({ type: "status", text: "Ready — rewound last prompt" });
  return messages;
};

const attachFilesAction = async (input: {
  page: Page;
  provider: BrowserProvider;
  paths: string[];
  emit: (event: OrchestratorEvent) => void;
}): Promise<void> => {
  input.emit({ type: "status", text: "Attaching files..." });
  await input.provider.attachFilesToPrompt(input.page, input.paths);
  input.emit({ type: "status", text: "Files attached." });
};

const stopResponseAction = async (input: {
  page: Page;
  provider: BrowserProvider;
  emit: (event: OrchestratorEvent) => void;
}): Promise<boolean> => {
  const stopped = await input.provider.stopGenerating(input.page);
  if (stopped) {
    input.emit({ type: "status", text: "Stopped response." });
  } else {
    input.emit({ type: "status", text: "No active response to stop." });
  }
  return stopped;
};

const executeSendPrompt = async (
  input: SendPromptInput & {
    page: Page | null;
    provider: BrowserProvider;
    emit: (event: OrchestratorEvent) => void;
    pushMessage: (message: Message) => void;
    manifestRoot?: string | undefined;
  },
): Promise<Message | null> => {
  const userMessage = conversationMessage("user", input.content);
  input.pushMessage(userMessage);
  input.emit({ type: "message", message: userMessage });
  input.emit({ type: "status", text: `Waiting for ${input.provider.displayName}...` });
  const page = requirePageForPrompt(input.page, input.emit);
  if (page === null) return null;
  try {
    const previousAssistantCount = await input.provider.countAssistantResponses(page);
    const previousLastAssistantText = await input.provider.captureLastResponse(page, {
      manifestRoot: input.manifestRoot,
    });
    await input.provider.injectPrompt(page, input.content);
    input.emit({ type: "status", text: `${input.provider.displayName} is responding...` });
    await input.provider.waitForResponse(page, {
      previousAssistantCount,
      previousLastAssistantText,
      timeout: input.timeoutMs,
      expectImages: input.expectImages,
    });
    const assistantText = await input.provider.captureLastResponse(page, {
      manifestRoot: input.manifestRoot,
    });
    const assistantMessage = conversationMessage("assistant", assistantText);
    input.pushMessage(assistantMessage);
    input.emit({ type: "message", message: assistantMessage });
    input.emit({ type: "status", text: "Ready" });
    return assistantMessage;
  } catch (error) {
    input.emit({ type: "error", error: formatError(error) });
    return null;
  }
};

const openConnectorSetup = async (
  input: ConnectorSetupInput & {
    page: Page | null;
    provider: BrowserProvider;
    emit: (event: OrchestratorEvent) => void;
  },
): Promise<ConnectorSetupResult> => {
  if (
    input.provider.supportsMcpConnector !== true ||
    input.provider.setupMcpConnector === undefined
  ) {
    input.emit({ type: "status", text: "Connector setup is not available for this provider." });
    return {
      connectorUrl: input.connectorUrl,
      completed: false,
      steps: [],
      warnings: [
        `${input.provider.displayName} web does not support custom MCP connectors.`,
        "Use @file mentions for read-only repo context, or switch to ChatGPT, Claude, or Grok for full MCP tools.",
      ],
    };
  }
  if (input.page === null) {
    input.emit({ type: "error", error: "Browser not connected." });
    return {
      connectorUrl: input.connectorUrl,
      completed: false,
      steps: [],
      warnings: [
        `Browser not connected. Open ${input.provider.displayName} settings manually and add the connector URL.`,
      ],
    };
  }
  if (input.automatic === true) {
    input.emit({
      type: "status",
      text: `Syncing ${input.provider.displayName} connector...`,
    });
  } else {
    input.emit({
      type: "status",
      text: `Opening ${input.provider.displayName} connector setup...`,
    });
  }
  const connectorSetup = await input.provider.setupMcpConnector(input.page, input.connectorUrl, {
    automatic: input.automatic,
    connectorName: input.connectorName,
  });
  if (connectorSetup.completed) {
    input.emit({ type: "status", text: "Connector ready." });
  } else {
    input.emit({ type: "status", text: "Connector setup needs manual finish." });
  }
  return connectorSetup;
};

export class Orchestrator {
  private readonly emitter = orchestratorEmitter();
  private messages: Message[] = [];
  private page: Page | null = null;
  private readonly provider: BrowserProvider;
  private readonly manifestRoot: string | undefined;
  private modelName: string;

  constructor(config: BridgeConfig, provider?: BrowserProvider, options: OrchestratorOptions = {}) {
    if (provider !== undefined) {
      this.provider = provider;
    } else {
      this.provider = providerFor(config.provider);
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
    void Promise.allSettled([this.detectModel()]);
  }

  on(listener: (event: OrchestratorEvent) => void): () => void {
    return this.emitter.on(listener);
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

  async sendPrompt(input: SendPromptInput): Promise<Message | null> {
    return executeSendPrompt({
      ...input,
      page: this.page,
      provider: this.provider,
      emit: this.emit.bind(this),
      manifestRoot: this.manifestRoot,
      pushMessage: (message) => {
        this.messages.push(message);
      },
    });
  }

  async listConversations(options?: { readonly orphans?: boolean }) {
    if (this.page === null) return [];
    return this.provider.readSidebarConversations(this.page, options);
  }

  async searchConversations(input: {
    query: string;
    limit?: number;
  }): Promise<ConversationSearchResult[]> {
    if (this.page === null) return [];
    return searchConversations({
      page: this.page,
      provider: this.provider,
      query: input.query,
      limit: input.limit,
    });
  }

  async listModels(): Promise<ModelOption[]> {
    const page = requirePage(this.page, this.emit.bind(this));
    if (page === null) return [];
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
    const page = requirePage(this.page, this.emit.bind(this));
    if (page === null) return this.modelName;
    this.modelName = await switchModelAction({
      page,
      provider: this.provider,
      query,
      emit: this.emit.bind(this),
    });
    return this.modelName;
  }

  async navigateToConversation(url: string): Promise<void> {
    const page = requirePage(this.page, this.emit.bind(this));
    if (page === null) return;
    if (isSameChatGptConversation(page.url(), url)) return;
    this.messages = await navigateToConversationAction({
      page,
      provider: this.provider,
      emit: this.emit.bind(this),
      url,
      manifestRoot: this.manifestRoot,
    });
  }

  async newConversation(): Promise<void> {
    const page = requirePage(this.page, this.emit.bind(this));
    if (page === null) return;
    await newConversationAction({ page, provider: this.provider, emit: this.emit.bind(this) });
    this.messages = [];
  }

  async rewindLastPrompt(replacement?: string): Promise<void> {
    const page = requirePage(this.page, this.emit.bind(this));
    if (page === null) return;
    this.messages = await rewindLastPromptAction({
      page,
      provider: this.provider,
      emit: this.emit.bind(this),
      replacement,
      manifestRoot: this.manifestRoot,
    });
  }

  async stopResponse(): Promise<boolean> {
    const page = requirePage(this.page, this.emit.bind(this));
    if (page === null) return false;
    return stopResponseAction({ page, provider: this.provider, emit: this.emit.bind(this) });
  }

  async attachFiles(paths: string[]): Promise<void> {
    const page = requirePage(this.page, this.emit.bind(this));
    if (page === null) return;
    await attachFilesAction({ page, provider: this.provider, paths, emit: this.emit.bind(this) });
  }

  async openConnectorSetup(input: ConnectorSetupInput): Promise<ConnectorSetupResult> {
    return openConnectorSetup({
      ...input,
      page: this.page,
      provider: this.provider,
      emit: this.emit.bind(this),
    });
  }

  async stop(): Promise<void> {
    this.emit({ type: "status", text: "Shutting down..." });
  }
}
