import type { Page } from "playwright";
import type { ConversationSearchReport } from "@/conversation-catalog/conversation-catalog-schemas.ts";
import { searchConversations } from "@/conversation-catalog/conversation-search.ts";
import type { BridgeSettings } from "@/domain/bridge-types.ts";
import type { ConnectorSetupReport, ModelOption } from "@/domain/connector-types.ts";
import type { Message, ToolReport } from "@/domain/message-types.ts";
import { findModelProfile } from "@/domain/model-lookup.ts";
import { type BrowserProvider, DEFAULT_CONNECTOR_NAME } from "@/providers/browser-provider.ts";
import { isSameChatGptConversation } from "@/providers/chatgpt/chatgpt-conversation-url.ts";
import { readProvider } from "@/providers/providers.ts";
import { MESSAGE_EVENT_TYPE } from "@/store/session-store.ts";

const MODEL_CHANGED_EVENT_TYPE = "model_changed";

const ASSISTANT_ROLE = "assistant";

const USER_ROLE = "user";

const STATUS_EVENT_TYPE = "status";
const ERROR_EVENT_TYPE = "error";
const READY_STATUS_LABEL = "Ready";

const BROWSER_NOT_CONNECTED_MESSAGE = "Browser not connected.";

export type SendPromptDetails = {
  content: string;
  timeoutMilliseconds?: number;
  expectImages?: number;
};

export type ConnectorSetupDetails = {
  connectorUrl: string;
  automatic?: boolean;
  connectorName?: string;
};

export type OrchestratorSettings = {
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

  emit({ type: ERROR_EVENT_TYPE, error: BROWSER_NOT_CONNECTED_MESSAGE });
  return null;
};

const requirePageForPrompt = (
  page: Page | null,
  emit: (event: OrchestratorEvent) => void,
): Page | null => {
  const hasPage = page != null;
  if (hasPage) return page;

  emit({ type: ERROR_EVENT_TYPE, error: "Browser not connected. Cannot send prompt." });
  return null;
};

const readConversationMessage = (role: Message["role"], message: string): Message => {
  return { id: crypto.randomUUID(), role, content: message, timestamp: Date.now() };
};

export const readErrorMessage = (error: unknown): string => {
  const isErrorObject = error instanceof Error;
  if (isErrorObject) return error.message;

  return String(error);
};

interface OrchestratorListenerRegistry {
  listeners: Array<(event: OrchestratorEvent) => void>;
}

const createOrchestratorEmitter = () => {
  const listenerRegistry: OrchestratorListenerRegistry = { listeners: [] };

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
        (message.role === USER_ROLE || message.role === ASSISTANT_ROLE) &&
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
  emit({ type: MODEL_CHANGED_EVENT_TYPE, model: modelName, contextLimit: profile.contextWindow });
};

const emitModelDetected = (emit: (event: OrchestratorEvent) => void, modelName: string): void => {
  const profile = findModelProfile(modelName);
  emit({ type: STATUS_EVENT_TYPE, text: `Model: ${modelName}` });
  emit({ type: MODEL_CHANGED_EVENT_TYPE, model: modelName, contextLimit: profile.contextWindow });
};

const detectModel = async (details: {
  page: Page | null;
  provider: BrowserProvider;
  modelName: string;
  emit: (event: OrchestratorEvent) => void;
}): Promise<string> => {
  const page = details.page;

  const isPageMissing = page == null;
  if (isPageMissing) return details.modelName;

  // Read the live model: a persisted label can be another provider's model after a --provider switch.
  const detected = await details.provider.detectCurrentModel(page);
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
  details.emit({ type: STATUS_EVENT_TYPE, text: `Switching model to ${details.query}...` });
  const modelName = await details.provider.selectModel(details.page, details.query);
  emitModelChanged(details.emit, modelName);
  details.emit({ type: STATUS_EVENT_TYPE, text: `Model: ${modelName}` });
  return modelName;
};

const syncConversationMessages = async (details: {
  page: Page | null;
  provider: BrowserProvider;
  emit: (event: OrchestratorEvent) => void;
  manifestRoot?: string | undefined;
}): Promise<Message[]> => {
  const page = details.page;

  const isPageMissing = page == null;
  if (isPageMissing) return [];

  const messages = listCapturedMessages(
    await details.provider.captureAllMessages(page, {
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
  details.emit({ type: STATUS_EVENT_TYPE, text: "Navigating to conversation..." });
  await details.provider.navigateToConversation(details.page, details.url);
  const messages = await syncConversationMessages(details);
  details.emit({ type: STATUS_EVENT_TYPE, text: READY_STATUS_LABEL });
  return messages;
};

const startNewConversationOnPage = async (details: {
  page: Page;
  provider: BrowserProvider;
  emit: (event: OrchestratorEvent) => void;
}): Promise<void> => {
  details.emit({ type: STATUS_EVENT_TYPE, text: "Starting new conversation..." });
  await details.provider.newConversation(details.page);
  details.emit({ type: "reset" });
  details.emit({ type: STATUS_EVENT_TYPE, text: "Ready — new conversation" });
};

const createRewindLastPromptAction = async (details: {
  page: Page;
  provider: BrowserProvider;
  emit: (event: OrchestratorEvent) => void;
  replacement?: string;
  manifestRoot?: string | undefined;
}): Promise<Message[]> => {
  details.emit({ type: STATUS_EVENT_TYPE, text: "Rewinding last prompt..." });
  await details.provider.rewindLastUserPrompt(details.page, details.replacement);
  const messages = await syncConversationMessages(details);
  details.emit({ type: STATUS_EVENT_TYPE, text: "Ready — rewound last prompt" });
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

  details.emit({ type: STATUS_EVENT_TYPE, text: "Attaching files..." });
  await details.provider.attachFilesToPrompt(details.page, details.paths);
  details.emit({ type: STATUS_EVENT_TYPE, text: "Files attached." });
};

const stopReplyAction = async (details: {
  page: Page;
  provider: BrowserProvider;
  emit: (event: OrchestratorEvent) => void;
}): Promise<boolean> => {
  const isStopped = await details.provider.stopGenerating(details.page);

  if (isStopped) {
    details.emit({ type: STATUS_EVENT_TYPE, text: "Stopped response." });
  } else {
    details.emit({ type: STATUS_EVENT_TYPE, text: "No active response to stop." });
  }

  return isStopped;
};

// A prompt goes out with the connector on in its chat. A failure logs one line and the prompt still sends.
const turnOnConnectorForPrompt = async (details: {
  page: Page;
  provider: BrowserProvider;
  connectorName: string | null;
  emit: (event: OrchestratorEvent) => void;
}): Promise<void> => {
  const isConnectorSetupNotReady = details.connectorName == null;
  if (isConnectorSetupNotReady) return;

  const turnOnConnectorInChat = details.provider.turnOnConnectorInChat;
  const isTurnOnUnavailable = turnOnConnectorInChat == null;
  if (isTurnOnUnavailable) return;

  try {
    await turnOnConnectorInChat.call(details.provider, details.page, details.connectorName);
  } catch (error) {
    const reason = readErrorMessage(error);
    details.emit({
      type: STATUS_EVENT_TYPE,
      text: `Connector: could not turn on ${details.connectorName} in this chat (${reason})`,
    });
  }
};

const executeSendPrompt = async (
  details: SendPromptDetails & {
    page: Page | null;
    provider: BrowserProvider;
    emit: (event: OrchestratorEvent) => void;
    pushMessage: (message: Message) => void;
    manifestRoot?: string | undefined;
    connectorName: string | null;
  },
): Promise<Message | null> => {
  const userMessage = readConversationMessage(USER_ROLE, details.content);
  details.pushMessage(userMessage);
  details.emit({ type: MESSAGE_EVENT_TYPE, message: userMessage });
  details.emit({ type: STATUS_EVENT_TYPE, text: `Waiting for ${details.provider.displayName}...` });
  const page = requirePageForPrompt(details.page, details.emit);

  const isPageMissing = page == null;
  if (isPageMissing) return null;

  try {
    const previousAssistantCount = await details.provider.countAssistantReplies(page);
    const previousAssistantReply = await details.provider.captureLastReply(page, {
      manifestRoot: details.manifestRoot,
    });
    await turnOnConnectorForPrompt({
      page,
      provider: details.provider,
      connectorName: details.connectorName,
      emit: details.emit,
    });
    await details.provider.injectPrompt(page, details.content);
    details.emit({
      type: STATUS_EVENT_TYPE,
      text: `${details.provider.displayName} is responding...`,
    });
    await details.provider.waitForReply(page, {
      previousAssistantCount,
      previousLastAssistantText: previousAssistantReply,
      timeout: details.timeoutMilliseconds,
      expectImages: details.expectImages,
    });
    const assistantReply = await details.provider.captureLastReply(page, {
      manifestRoot: details.manifestRoot,
    });
    const assistantMessage = readConversationMessage(ASSISTANT_ROLE, assistantReply);
    details.pushMessage(assistantMessage);
    details.emit({ type: MESSAGE_EVENT_TYPE, message: assistantMessage });
    details.emit({ type: STATUS_EVENT_TYPE, text: READY_STATUS_LABEL });
    return assistantMessage;
  } catch (error) {
    const errorMessage = readErrorMessage(error);
    details.emit({ type: ERROR_EVENT_TYPE, error: errorMessage });
    return null;
  }
};

const readConnectorSetupWithinDeadline = async (details: {
  startSetup: (setupSignal: AbortSignal) => Promise<ConnectorSetupReport>;
  connectorUrl: string;
}): Promise<ConnectorSetupReport> => {
  const connectorSetupTimeoutMilliseconds = 120_000;
  const deadlineSignal = AbortSignal.timeout(connectorSetupTimeoutMilliseconds);

  const deadline = new Promise<never>((_, reject) => {
    deadlineSignal.addEventListener(
      "abort",
      () => {
        reject(
          new Error(
            `Connector setup did not finish within ${connectorSetupTimeoutMilliseconds / 1000} seconds.`,
          ),
        );
      },
      { once: true },
    );
  });

  try {
    const setupTask = details.startSetup(deadlineSignal);
    return await Promise.race([setupTask, deadline]);
  } catch (error) {
    const failureReason = readErrorMessage(error);
    return {
      connectorUrl: details.connectorUrl,
      completed: false,
      steps: [],
      warnings: [failureReason],
    };
  }
};

// Setup runs in its own tab, so the chat tab stays free for prompts while setup works.
const readConnectorSetupInOwnTab = async (details: {
  chatPage: Page;
  connectorUrl: string;
  startSetup: (setupPage: Page, setupSignal: AbortSignal) => Promise<ConnectorSetupReport>;
}): Promise<ConnectorSetupReport> => {
  const setupPage = await details.chatPage.context().newPage();
  try {
    return await readConnectorSetupWithinDeadline({
      startSetup: (setupSignal) => details.startSetup(setupPage, setupSignal),
      connectorUrl: details.connectorUrl,
    });
  } finally {
    await setupPage.close();
  }
};

const openConnectorSetup = async (
  details: ConnectorSetupDetails & {
    page: Page | null;
    provider: BrowserProvider;
    emit: (event: OrchestratorEvent) => void;
  },
): Promise<ConnectorSetupReport> => {
  const setupMcpConnector = details.provider.setupMcpConnector;
  const isConnectorSetupUnavailable =
    details.provider.supportsMcpConnector !== true || setupMcpConnector == null;
  if (isConnectorSetupUnavailable) {
    details.emit({
      type: STATUS_EVENT_TYPE,
      text: "Connector setup is not available for this provider.",
    });
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

  const page = details.page;

  const isPageMissing = page == null;
  if (isPageMissing) {
    details.emit({ type: ERROR_EVENT_TYPE, error: BROWSER_NOT_CONNECTED_MESSAGE });
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
      type: STATUS_EVENT_TYPE,
      text: `Syncing ${details.provider.displayName} connector...`,
    });
  } else {
    details.emit({
      type: STATUS_EVENT_TYPE,
      text: `Opening ${details.provider.displayName} connector setup...`,
    });
  }

  const connectorSetup = await readConnectorSetupInOwnTab({
    chatPage: page,
    connectorUrl: details.connectorUrl,
    startSetup: (setupPage, setupSignal) =>
      setupMcpConnector.call(details.provider, setupPage, details.connectorUrl, {
        automatic: details.automatic,
        connectorName: details.connectorName,
        signal: setupSignal,
      }),
  });

  const isConnectorSetupReady = connectorSetup.completed;
  if (isConnectorSetupReady) {
    details.emit({ type: STATUS_EVENT_TYPE, text: "Connector ready." });
  } else {
    details.emit({ type: STATUS_EVENT_TYPE, text: "Connector setup needs manual finish." });
  }

  return connectorSetup;
};

export class Orchestrator {
  private readonly emitter = createOrchestratorEmitter();
  private messages: Message[] = [];
  page: Page | null = null;
  private readonly provider: BrowserProvider;
  private readonly manifestRoot: string | undefined;
  private modelName: string;
  private pageHoldTask: Promise<void> | null = null;
  // The connector name once its setup in this session is ready; null until then.
  private readyConnectorName: string | null = null;

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

    this.modelName = settings.model ?? this.provider.defaultModel;
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

  // Prompts and file attachments wait until the start ends; connector setup runs in its own tab.
  holdPageUntil(bootTask: Promise<void>): void {
    this.pageHoldTask = bootTask;
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

    this.emit({ type: STATUS_EVENT_TYPE, text: "Bridge ready. Type a prompt to begin." });
  }

  async sendPrompt(details: SendPromptDetails): Promise<Message | null> {
    await this.pageHoldTask;
    return executeSendPrompt({
      ...details,
      page: this.page,
      provider: this.provider,
      emit: this.emit.bind(this),
      manifestRoot: this.manifestRoot,
      connectorName: this.readyConnectorName,
      pushMessage: (message) => {
        this.messages.push(message);
      },
    });
  }

  async listConversations(settings?: { readonly orphans?: boolean }) {
    const page = this.page;
    const isPageMissing = page == null;

    const isOrphanScanWithoutPage = isPageMissing && settings?.orphans === true;
    if (isOrphanScanWithoutPage) throw new Error("No ChatGPT page is open to read loose chats.");

    if (isPageMissing) return [];

    return this.provider.readSidebarConversations(page, settings);
  }

  async searchConversations(details: {
    query: string;
    limit?: number;
  }): Promise<ConversationSearchReport[]> {
    const page = this.page;

    const isPageMissing = page == null;
    if (isPageMissing) return [];

    return searchConversations({
      page,
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
    await this.pageHoldTask;
    const boundEmit = this.emit.bind(this);
    const page = requirePage(this.page, boundEmit);

    const isPageMissing = page == null;
    if (isPageMissing) return;

    await attachFilesAction({ page, provider: this.provider, paths, emit: this.emit.bind(this) });
  }

  async openConnectorSetup(details: ConnectorSetupDetails): Promise<ConnectorSetupReport> {
    const connectorSetup = await openConnectorSetup({
      ...details,
      page: this.page,
      provider: this.provider,
      emit: this.emit.bind(this),
    });

    const isConnectorSetupReady = connectorSetup.completed;
    if (isConnectorSetupReady) {
      this.readyConnectorName = details.connectorName ?? DEFAULT_CONNECTOR_NAME;
    }

    return connectorSetup;
  }

  async stop(): Promise<void> {
    this.emit({ type: STATUS_EVENT_TYPE, text: "Shutting down..." });
  }
}
