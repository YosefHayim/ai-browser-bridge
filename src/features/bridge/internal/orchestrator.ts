import { searchConversations } from "@/features/conversationCatalog";
import type { ConversationSearchResult } from "@/features/conversationCatalog";
import { findModelProfile } from "@/features/domain";
import type {
  BridgeConfig,
  ConnectorSetupResult,
  Message,
  ModelOption,
  ToolResult,
} from "@/features/domain";
import { isSameChatGptConversation } from "@/features/providers";
import { type BrowserProvider, getBrowserProvider } from "@/features/providers";
import type { Page } from "playwright";

/** Options for sending a prompt through the orchestrator. */
export interface SendPromptOptions {
  timeoutMs?: number;
}

/** Input for {@link Orchestrator.sendPrompt}. */
export interface SendPromptInput {
  content: string;
  timeoutMs?: number;
  /** Number of generated images to wait for before the turn settles (ChatGPT only). */
  expectImages?: number;
}

/** Input for {@link Orchestrator.openConnectorSetup}. */
export interface ConnectorSetupInput {
  connectorUrl: string;
  automatic?: boolean;
  connectorName?: string;
}

/** Events emitted by {@link Orchestrator} to listeners. */
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

/** Callback registered via {@link Orchestrator.on}. */
export type OrchestratorListener = (event: OrchestratorEvent) => void;

const requirePage = (page: Page | null, emit: (event: OrchestratorEvent) => void): Page | null => {
  if (page) return page;
  emit({ type: "error", error: "Browser not connected." });
  return null;
};

const requirePageForPrompt = (
  page: Page | null,
  emit: (event: OrchestratorEvent) => void,
): Page | null => {
  if (page) return page;
  emit({ type: "error", error: "Browser not connected. Cannot send prompt." });
  return null;
};

const buildMessage = (role: Message["role"], content: string): Message => {
  return { id: crypto.randomUUID(), role, content, timestamp: Date.now() };
};

const formatError = (err: unknown): string => {
  return err instanceof Error ? err.message : String(err);
};

const createOrchestratorEmitter = () => {
  const state = { listeners: [] as Array<(event: OrchestratorEvent) => void> };
  return {
    on(fn: (event: OrchestratorEvent) => void) {
      state.listeners.push(fn);
      return () => {
        state.listeners = state.listeners.filter((listener) => listener !== fn);
      };
    },
    emit(event: OrchestratorEvent) {
      for (const fn of state.listeners) fn(event);
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
  if (!input.page) return input.modelName;
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
  if (!selected) return null;
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
  if (selected) input.setModelName(selected);
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
}): Promise<Message[]> => {
  if (!input.page) return [];
  const messages = mapCapturedMessages(await input.provider.captureAllMessages(input.page));
  if (messages.length === 0) return [];
  input.emit({ type: "conversation_synced", messages });
  return messages;
};

const navigateToConversationAction = async (input: {
  page: Page;
  provider: BrowserProvider;
  emit: (event: OrchestratorEvent) => void;
  url: string;
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
  input.emit({
    type: "status",
    text: stopped ? "Stopped response." : "No active response to stop.",
  });
  return stopped;
};

const executeSendPrompt = async (
  input: SendPromptInput & {
    page: Page | null;
    provider: BrowserProvider;
    emit: (event: OrchestratorEvent) => void;
    pushMessage: (message: Message) => void;
  },
): Promise<Message | null> => {
  const userMsg = buildMessage("user", input.content);
  input.pushMessage(userMsg);
  input.emit({ type: "message", message: userMsg });
  input.emit({ type: "status", text: `Waiting for ${input.provider.displayName}...` });
  const page = requirePageForPrompt(input.page, input.emit);
  if (!page) return null;
  try {
    const previousAssistantCount = await input.provider.countAssistantResponses(page);
    const previousLastAssistantText = await input.provider.captureLastResponse(page);
    await input.provider.injectPrompt(page, input.content);
    input.emit({ type: "status", text: `${input.provider.displayName} is responding...` });
    await input.provider.waitForResponse(page, {
      previousAssistantCount,
      previousLastAssistantText,
      timeout: input.timeoutMs,
      expectImages: input.expectImages,
    });
    const responseText = await input.provider.captureLastResponse(page);
    const assistantMsg = buildMessage("assistant", responseText);
    input.pushMessage(assistantMsg);
    input.emit({ type: "message", message: assistantMsg });
    input.emit({ type: "status", text: "Ready" });
    return assistantMsg;
  } catch (err) {
    input.emit({ type: "error", error: formatError(err) });
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
  if (!input.provider.supportsMcpConnector || !input.provider.setupMcpConnector) {
    input.emit({ type: "status", text: "Connector setup is not available for this provider." });
    return {
      connectorUrl: input.connectorUrl,
      completed: false,
      steps: [],
      warnings: [
        `${input.provider.displayName} web does not support custom MCP connectors.`,
        "Use @file mentions for read-only repo context, or switch to ChatGPT for full MCP tools.",
      ],
    };
  }
  if (!input.page) {
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
  input.emit({
    type: "status",
    text: input.automatic
      ? `Syncing ${input.provider.displayName} connector...`
      : `Opening ${input.provider.displayName} connector setup...`,
  });
  const result = await input.provider.setupMcpConnector(input.page, input.connectorUrl, {
    automatic: input.automatic,
    connectorName: input.connectorName,
  });
  input.emit({
    type: "status",
    text: result.completed ? "Connector ready." : "Connector setup needs manual finish.",
  });
  return result;
};

export class Orchestrator {
  private readonly emitter = createOrchestratorEmitter();
  private messages: Message[] = [];
  private page: Page | null = null;
  private readonly provider: BrowserProvider;
  private modelName: string;

  constructor(
    private _config: BridgeConfig,
    provider?: BrowserProvider,
  ) {
    this.provider = provider ?? getBrowserProvider(_config.provider);
    this.modelName = _config.model ?? this.provider.defaultModel;
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

  /**
   * Attach the Playwright page used for browser automation.
   *
   * @param page - Page value.
   * @returns Completes when `setPage` finishes.
   * @example
   * ```ts
   * orchestrator.setPage(page);
   * ```
   */
  setPage(page: Page): void {
    this.page = page;
    this.detectModel().catch(() => {});
  }

  /**
   * Subscribe to orchestrator events (status, messages, errors).
   *
   * @param fn - Fn value.
   * @returns The `on` result.
   * @example
   * ```ts
   * const result = orchestrator.on(fn);
   * ```
   */
  on(fn: (event: OrchestratorEvent) => void): () => void {
    return this.emitter.on(fn);
  }

  private emit(event: OrchestratorEvent): void {
    this.emitter.emit(event);
  }

  /**
   * Detect and cache the current model from the browser UI.
   *
   * @returns The `detectModel` result.
   * @example
   * ```ts
   * const result = await orchestrator.detectModel();
   * ```
   */
  async detectModel(): Promise<string> {
    this.modelName = await detectModel({
      page: this.page,
      provider: this.provider,
      modelName: this.modelName,
      emit: this.emit.bind(this),
    });
    return this.modelName;
  }

  /**
   * Sync conversation history and emit ready status.
   *
   * @returns Completes when `start` finishes.
   * @example
   * ```ts
   * await orchestrator.start();
   * ```
   */
  async start(): Promise<void> {
    this.messages = await syncConversationMessages({
      page: this.page,
      provider: this.provider,
      emit: this.emit.bind(this),
    });
    this.detectModel().catch(() => {});
    this.emit({ type: "status", text: "Bridge ready. Type a prompt to begin." });
  }

  /**
   * Send a user prompt and wait for the assistant response.
   *
   * @param input - Input values for the method.
   * @returns The `sendPrompt` result.
   * @example
   * ```ts
   * const result = await orchestrator.sendPrompt(input);
   * ```
   */
  async sendPrompt(input: SendPromptInput): Promise<Message | null> {
    return executeSendPrompt({
      ...input,
      page: this.page,
      provider: this.provider,
      emit: this.emit.bind(this),
      pushMessage: (m) => {
        this.messages.push(m);
      },
    });
  }

  /**
   * List sidebar conversations when a page is attached.
   *
   * @returns The `listConversations` result.
   * @example
   * ```ts
   * const result = await orchestrator.listConversations();
   * ```
   */
  async listConversations() {
    return this.page ? this.provider.readSidebarConversations(this.page) : [];
  }

  /**
   * Search provider conversation history when a page is attached.
   *
   * @param input - Input values for the method.
   * @returns The `searchConversations` result.
   * @example
   * ```ts
   * const result = await orchestrator.searchConversations(input);
   * ```
   */
  async searchConversations(input: {
    query: string;
    limit?: number;
  }): Promise<ConversationSearchResult[]> {
    return this.page
      ? searchConversations({
          page: this.page,
          provider: this.provider,
          query: input.query,
          limit: input.limit,
        })
      : [];
  }

  /**
   * List models available in the provider UI.
   *
   * @returns The `listModels` result.
   * @example
   * ```ts
   * const result = await orchestrator.listModels();
   * ```
   */
  async listModels(): Promise<ModelOption[]> {
    const page = requirePage(this.page, this.emit.bind(this));
    return page
      ? listModelsAction({
          page,
          provider: this.provider,
          emit: this.emit.bind(this),
          setModelName: (name) => {
            this.modelName = name;
          },
        })
      : [];
  }

  /**
   * Switch the active model using a label query.
   *
   * @param query - Query text for the method.
   * @returns The `switchModel` result.
   * @example
   * ```ts
   * const result = await orchestrator.switchModel(query);
   * ```
   */
  async switchModel(query: string): Promise<string> {
    const page = requirePage(this.page, this.emit.bind(this));
    if (!page) return this.modelName;
    this.modelName = await switchModelAction({
      page,
      provider: this.provider,
      query,
      emit: this.emit.bind(this),
    });
    return this.modelName;
  }

  /**
   * Navigate to a conversation URL and refresh cached messages.
   *
   * @param url - Url value.
   * @returns Completes when `navigateToConversation` finishes.
   * @example
   * ```ts
   * await orchestrator.navigateToConversation(url);
   * ```
   */
  async navigateToConversation(url: string): Promise<void> {
    const page = requirePage(this.page, this.emit.bind(this));
    if (page?.url() && isSameChatGptConversation(page.url(), url)) return;
    if (page) {
      this.messages = await navigateToConversationAction({
        page,
        provider: this.provider,
        emit: this.emit.bind(this),
        url,
      });
    }
  }

  /**
   * Start a new conversation in the provider UI.
   *
   * @returns Completes when `newConversation` finishes.
   * @example
   * ```ts
   * await orchestrator.newConversation();
   * ```
   */
  async newConversation(): Promise<void> {
    const page = requirePage(this.page, this.emit.bind(this));
    if (!page) return;
    await newConversationAction({ page, provider: this.provider, emit: this.emit.bind(this) });
    this.messages = [];
  }

  /**
   * Rewind the last user prompt, optionally replacing its text.
   *
   * @param replacement - Replacement value.
   * @returns Completes when `rewindLastPrompt` finishes.
   * @example
   * ```ts
   * await orchestrator.rewindLastPrompt(replacement);
   * ```
   */
  async rewindLastPrompt(replacement?: string): Promise<void> {
    const page = requirePage(this.page, this.emit.bind(this));
    if (page) {
      this.messages = await rewindLastPromptAction({
        page,
        provider: this.provider,
        emit: this.emit.bind(this),
        replacement,
      });
    }
  }

  /**
   * Stop the in-progress assistant response when possible.
   *
   * @returns The `stopResponse` result.
   * @example
   * ```ts
   * const result = await orchestrator.stopResponse();
   * ```
   */
  async stopResponse(): Promise<boolean> {
    const page = requirePage(this.page, this.emit.bind(this));
    return page
      ? stopResponseAction({ page, provider: this.provider, emit: this.emit.bind(this) })
      : false;
  }

  /**
   * Attach local files to the provider composer.
   *
   * @param paths - Paths value.
   * @returns Completes when `attachFiles` finishes.
   * @example
   * ```ts
   * await orchestrator.attachFiles(paths);
   * ```
   */
  async attachFiles(paths: string[]): Promise<void> {
    const page = requirePage(this.page, this.emit.bind(this));
    if (page)
      await attachFilesAction({ page, provider: this.provider, paths, emit: this.emit.bind(this) });
  }

  /**
   * Open or sync the ChatGPT MCP connector setup UI.
   *
   * @param input - Input values for the method.
   * @returns The `openConnectorSetup` result.
   * @example
   * ```ts
   * const result = await orchestrator.openConnectorSetup(input);
   * ```
   */
  async openConnectorSetup(input: ConnectorSetupInput): Promise<ConnectorSetupResult> {
    return openConnectorSetup({
      ...input,
      page: this.page,
      provider: this.provider,
      emit: this.emit.bind(this),
    });
  }

  /**
   * Emit shutdown status before the engine tears down.
   *
   * @returns Completes when `stop` finishes.
   * @example
   * ```ts
   * await orchestrator.stop();
   * ```
   */
  async stop(): Promise<void> {
    this.emit({ type: "status", text: "Shutting down..." });
  }
}
