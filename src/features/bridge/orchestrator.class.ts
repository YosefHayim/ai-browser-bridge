import type { Page } from "playwright";
import type { BridgeConfig, Message, ModelOption, ConnectorSetupResult, ToolResult } from "../domain/types.ts";
import { findModelProfile } from "../domain/models.config.ts";
import { getBrowserProvider, type BrowserProvider } from "../providers/create-provider.factory.ts";

/** Options for sending a prompt through the orchestrator. */
export interface SendPromptOptions {
  timeoutMs?: number;
}

/** Input for {@link Orchestrator.sendPrompt}. */
export interface SendPromptInput {
  content: string;
  timeoutMs?: number;
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

function requirePage(page: Page | null, emit: (event: OrchestratorEvent) => void): Page | null {
  if (page) return page;
  emit({ type: "error", error: "Browser not connected." });
  return null;
}

function requirePageForPrompt(page: Page | null, emit: (event: OrchestratorEvent) => void): Page | null {
  if (page) return page;
  emit({ type: "error", error: "Browser not connected. Cannot send prompt." });
  return null;
}

function buildMessage(role: Message["role"], content: string): Message {
  return { id: crypto.randomUUID(), role, content, timestamp: Date.now() };
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function createOrchestratorEmitter() {
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
}

function mapCapturedMessages(captured: Array<{ role: string; content: string }>): Message[] {
  return captured
    .filter((message): message is { role: "user" | "assistant"; content: string } =>
      (message.role === "user" || message.role === "assistant") && message.content.trim().length > 0,
    )
    .map((message) => ({
      id: `dom-${crypto.randomUUID()}`,
      role: message.role,
      content: message.content,
      timestamp: Date.now(),
    }));
}

function emitModelChanged(emit: (event: OrchestratorEvent) => void, modelName: string): void {
  const profile = findModelProfile(modelName);
  emit({ type: "model_changed", model: modelName, contextLimit: profile.contextWindow });
}

function emitModelDetected(emit: (event: OrchestratorEvent) => void, modelName: string): void {
  const profile = findModelProfile(modelName);
  emit({ type: "status", text: `Model: ${modelName}` });
  emit({ type: "model_changed", model: modelName, contextLimit: profile.contextWindow });
}

async function detectModel(input: {
  page: Page | null;
  provider: BrowserProvider;
  modelName: string;
  emit: (event: OrchestratorEvent) => void;
}): Promise<string> {
  if (!input.page) return input.modelName;
  const detected = await input.provider.detectCurrentModel(input.page);
  const nextName = detected !== input.provider.defaultModel
    ? detected
    : input.provider.isLikelyModelLabel(input.modelName)
      ? input.modelName
      : input.provider.defaultModel;
  emitModelDetected(input.emit, nextName);
  return nextName;
}

function applySelectedModel(models: ModelOption[], emit: (event: OrchestratorEvent) => void): string | null {
  const selected = models.find((model) => model.selected);
  if (!selected) return null;
  emitModelChanged(emit, selected.label);
  return selected.label;
}

async function listModelsAction(input: {
  page: Page;
  provider: BrowserProvider;
  emit: (event: OrchestratorEvent) => void;
  setModelName: (name: string) => void;
}): Promise<ModelOption[]> {
  const models = await input.provider.listAvailableModels(input.page);
  const selected = applySelectedModel(models, input.emit);
  if (selected) input.setModelName(selected);
  return models;
}

async function switchModelAction(input: {
  page: Page;
  provider: BrowserProvider;
  query: string;
  emit: (event: OrchestratorEvent) => void;
}): Promise<string> {
  input.emit({ type: "status", text: `Switching model to ${input.query}...` });
  const modelName = await input.provider.selectModel(input.page, input.query);
  emitModelChanged(input.emit, modelName);
  input.emit({ type: "status", text: `Model: ${modelName}` });
  return modelName;
}

async function syncConversationMessages(input: {
  page: Page | null;
  provider: BrowserProvider;
  emit: (event: OrchestratorEvent) => void;
}): Promise<Message[]> {
  if (!input.page) return [];
  const messages = mapCapturedMessages(await input.provider.captureAllMessages(input.page));
  if (messages.length === 0) return [];
  input.emit({ type: "conversation_synced", messages });
  return messages;
}

async function navigateToConversationAction(input: {
  page: Page;
  provider: BrowserProvider;
  emit: (event: OrchestratorEvent) => void;
  url: string;
}): Promise<Message[]> {
  input.emit({ type: "status", text: "Navigating to conversation..." });
  await input.provider.navigateToConversation(input.page, input.url);
  const messages = await syncConversationMessages(input);
  input.emit({ type: "status", text: "Ready" });
  return messages;
}

async function newConversationAction(input: {
  page: Page;
  provider: BrowserProvider;
  emit: (event: OrchestratorEvent) => void;
}): Promise<void> {
  input.emit({ type: "status", text: "Starting new conversation..." });
  await input.provider.newConversation(input.page);
  input.emit({ type: "reset" });
  input.emit({ type: "status", text: "Ready — new conversation" });
}

async function rewindLastPromptAction(input: {
  page: Page;
  provider: BrowserProvider;
  emit: (event: OrchestratorEvent) => void;
  replacement?: string;
}): Promise<Message[]> {
  input.emit({ type: "status", text: "Rewinding last prompt..." });
  await input.provider.rewindLastUserPrompt(input.page, input.replacement);
  const messages = await syncConversationMessages(input);
  input.emit({ type: "status", text: "Ready — rewound last prompt" });
  return messages;
}

async function attachFilesAction(input: {
  page: Page;
  provider: BrowserProvider;
  paths: string[];
  emit: (event: OrchestratorEvent) => void;
}): Promise<void> {
  input.emit({ type: "status", text: "Attaching files..." });
  await input.provider.attachFilesToPrompt(input.page, input.paths);
  input.emit({ type: "status", text: "Files attached." });
}

async function stopResponseAction(input: {
  page: Page;
  provider: BrowserProvider;
  emit: (event: OrchestratorEvent) => void;
}): Promise<boolean> {
  const stopped = await input.provider.stopGenerating(input.page);
  input.emit({ type: "status", text: stopped ? "Stopped response." : "No active response to stop." });
  return stopped;
}

async function executeSendPrompt(input: SendPromptInput & {
  page: Page | null;
  provider: BrowserProvider;
  emit: (event: OrchestratorEvent) => void;
  pushMessage: (message: Message) => void;
}): Promise<Message | null> {
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
}

async function openConnectorSetup(input: ConnectorSetupInput & {
  page: Page | null;
  provider: BrowserProvider;
  emit: (event: OrchestratorEvent) => void;
}): Promise<ConnectorSetupResult> {
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
      warnings: ["Browser not connected. Open ChatGPT settings manually and paste the connector URL."],
    };
  }
  input.emit({
    type: "status",
    text: input.automatic ? "Syncing ChatGPT connector..." : "Opening ChatGPT connector setup...",
  });
  const result = await input.provider.setupMcpConnector(input.page, input.connectorUrl, {
    automatic: input.automatic,
    connectorName: input.connectorName,
  });
  input.emit({ type: "status", text: result.completed ? "Connector ready." : "Connector setup needs manual finish." });
  return result;
}

export class Orchestrator {
  private readonly emitter = createOrchestratorEmitter();
  private messages: Message[] = [];
  private page: Page | null = null;
  private readonly provider: BrowserProvider;
  private modelName: string;

  constructor(private _config: BridgeConfig, provider?: BrowserProvider) {
    this.provider = provider ?? getBrowserProvider(_config.provider);
    this.modelName = _config.model ?? this.provider.defaultModel;
  }

  get browserProvider(): BrowserProvider { return this.provider; }
  get model(): string { return this.modelName; }
  get currentMessages(): Message[] { return this.messages; }

  /** Attach the Playwright page used for browser automation. */
  setPage(page: Page): void {
    this.page = page;
    this.detectModel().catch(() => {});
  }

  /** Subscribe to orchestrator events (status, messages, errors). */
  on(fn: (event: OrchestratorEvent) => void): () => void {
    return this.emitter.on(fn);
  }

  private emit(event: OrchestratorEvent): void {
    this.emitter.emit(event);
  }

  /** Detect and cache the current model from the browser UI. */
  async detectModel(): Promise<string> {
    this.modelName = await detectModel({ page: this.page, provider: this.provider, modelName: this.modelName, emit: this.emit.bind(this) });
    return this.modelName;
  }

  /** Sync conversation history and emit ready status. */
  async start(): Promise<void> {
    this.messages = await syncConversationMessages({ page: this.page, provider: this.provider, emit: this.emit.bind(this) });
    this.detectModel().catch(() => {});
    this.emit({ type: "status", text: "Bridge ready. Type a prompt to begin." });
  }

  /** Send a user prompt and wait for the assistant response. */
  async sendPrompt(input: SendPromptInput): Promise<Message | null> {
    return executeSendPrompt({
      ...input,
      page: this.page,
      provider: this.provider,
      emit: this.emit.bind(this),
      pushMessage: (m) => { this.messages.push(m); },
    });
  }

  /** List sidebar conversations when a page is attached. */
  async listConversations() {
    return this.page ? this.provider.readSidebarConversations(this.page) : [];
  }

  /** List models available in the provider UI. */
  async listModels(): Promise<ModelOption[]> {
    const page = requirePage(this.page, this.emit.bind(this));
    return page
      ? listModelsAction({ page, provider: this.provider, emit: this.emit.bind(this), setModelName: (name) => { this.modelName = name; } })
      : [];
  }

  /** Switch the active model using a label query. */
  async switchModel(query: string): Promise<string> {
    const page = requirePage(this.page, this.emit.bind(this));
    if (!page) return this.modelName;
    this.modelName = await switchModelAction({ page, provider: this.provider, query, emit: this.emit.bind(this) });
    return this.modelName;
  }

  /** Navigate to a conversation URL and refresh cached messages. */
  async navigateToConversation(url: string): Promise<void> {
    const page = requirePage(this.page, this.emit.bind(this));
    if (page) {
      this.messages = await navigateToConversationAction({ page, provider: this.provider, emit: this.emit.bind(this), url });
    }
  }

  /** Start a new conversation in the provider UI. */
  async newConversation(): Promise<void> {
    const page = requirePage(this.page, this.emit.bind(this));
    if (!page) return;
    await newConversationAction({ page, provider: this.provider, emit: this.emit.bind(this) });
    this.messages = [];
  }

  /** Rewind the last user prompt, optionally replacing its text. */
  async rewindLastPrompt(replacement?: string): Promise<void> {
    const page = requirePage(this.page, this.emit.bind(this));
    if (page) {
      this.messages = await rewindLastPromptAction({ page, provider: this.provider, emit: this.emit.bind(this), replacement });
    }
  }

  /** Stop the in-progress assistant response when possible. */
  async stopResponse(): Promise<boolean> {
    const page = requirePage(this.page, this.emit.bind(this));
    return page ? stopResponseAction({ page, provider: this.provider, emit: this.emit.bind(this) }) : false;
  }

  /** Attach local files to the provider composer. */
  async attachFiles(paths: string[]): Promise<void> {
    const page = requirePage(this.page, this.emit.bind(this));
    if (page) await attachFilesAction({ page, provider: this.provider, paths, emit: this.emit.bind(this) });
  }

  /** Open or sync the ChatGPT MCP connector setup UI. */
  async openConnectorSetup(input: ConnectorSetupInput): Promise<ConnectorSetupResult> {
    return openConnectorSetup({ ...input, page: this.page, provider: this.provider, emit: this.emit.bind(this) });
  }

  /** Emit shutdown status before the engine tears down. */
  async stop(): Promise<void> {
    this.emit({ type: "status", text: "Shutting down..." });
  }
}
