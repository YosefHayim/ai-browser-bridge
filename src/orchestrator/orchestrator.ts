import type { Page } from "playwright";
import type { BridgeSettings } from "@/bridge-types.ts";
import type { ConnectorSetupReport, ModelOption } from "@/connector-types.ts";
import type { ConversationSearchReport } from "@/conversation-catalog/conversation-catalog-schemas.ts";
import { searchConversations } from "@/conversation-catalog/conversation-search.ts";
import type { Message, ToolReport } from "@/message-types.ts";
import { findModelProfile } from "@/model-profiles/model-lookup.ts";
import type { BridgeProviderId } from "@/provider-settings.ts";
import { isSameChatGptConversation } from "@/providers/chatgpt/backend-api/chatgpt-conversation-url.ts";
import {
  type BrowserProvider,
  DEFAULT_CONNECTOR_NAME,
  type ProviderProfile,
} from "@/providers/engine/browser-provider.ts";
import { createProvider, readProviderIdFrom, readProviderProfile } from "@/providers/providers.ts";
import { readErrorMessage } from "@/read-error-message.ts";
import { MESSAGE_EVENT_TYPE } from "@/sessions/session-store.ts";

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
  createProvider?: (providerId: BridgeProviderId, page: Page) => BrowserProvider;
};

type AttachedTab = {
  page: Page;
  provider: BrowserProvider;
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

function requireTab(
  tab: AttachedTab | null,
  emit: (event: OrchestratorEvent) => void,
): AttachedTab | null {
  const hasTab = tab != null;
  if (hasTab) return tab;

  emit({ type: ERROR_EVENT_TYPE, error: BROWSER_NOT_CONNECTED_MESSAGE });
  return null;
}

function requireProviderForPrompt(
  provider: BrowserProvider | null,
  emit: (event: OrchestratorEvent) => void,
): BrowserProvider | null {
  const hasProvider = provider != null;
  if (hasProvider) return provider;

  emit({ type: ERROR_EVENT_TYPE, error: "Browser not connected. Cannot send prompt." });
  return null;
}

function readConversationMessage(role: Message["role"], message: string): Message {
  return { id: crypto.randomUUID(), role, content: message, timestamp: Date.now() };
}

interface OrchestratorListenerRegistry {
  listeners: Array<(event: OrchestratorEvent) => void>;
}

function createOrchestratorEmitter() {
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
}

function listCapturedMessages(captured: Array<{ role: string; content: string }>): Message[] {
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
}

function emitModelChanged(emit: (event: OrchestratorEvent) => void, modelName: string): void {
  const profile = findModelProfile(modelName);
  emit({ type: MODEL_CHANGED_EVENT_TYPE, model: modelName, contextLimit: profile.contextWindow });
}

function emitModelDetected(emit: (event: OrchestratorEvent) => void, modelName: string): void {
  const profile = findModelProfile(modelName);
  emit({ type: STATUS_EVENT_TYPE, text: `Model: ${modelName}` });
  emit({ type: MODEL_CHANGED_EVENT_TYPE, model: modelName, contextLimit: profile.contextWindow });
}

async function detectModel(details: {
  provider: BrowserProvider | null;
  modelName: string;
  emit: (event: OrchestratorEvent) => void;
}): Promise<string> {
  const provider = details.provider;

  const isProviderMissing = provider == null;
  if (isProviderMissing) return details.modelName;

  // Read the live model: a persisted label can be another provider's model after a --provider switch.
  const detected = await provider.detectCurrentModel();
  emitModelDetected(details.emit, detected);
  return detected;
}

function applySelectedModel(
  models: ModelOption[],
  emit: (event: OrchestratorEvent) => void,
): string | null {
  const selected = models.find((model) => model.selected);

  const isSelectedMissing = selected == null;
  if (isSelectedMissing) return null;

  emitModelChanged(emit, selected.label);
  return selected.label;
}

async function listModelsAction(details: {
  provider: BrowserProvider;
  emit: (event: OrchestratorEvent) => void;
  setModelName: (name: string) => void;
}): Promise<ModelOption[]> {
  const models = await details.provider.listAvailableModels();
  const selected = applySelectedModel(models, details.emit);

  const hasSelected = selected != null;
  if (hasSelected) details.setModelName(selected);

  return models;
}

async function switchModelAction(details: {
  provider: BrowserProvider;
  query: string;
  emit: (event: OrchestratorEvent) => void;
}): Promise<string> {
  details.emit({ type: STATUS_EVENT_TYPE, text: `Switching model to ${details.query}...` });
  const modelName = await details.provider.selectModel(details.query);
  emitModelChanged(details.emit, modelName);
  details.emit({ type: STATUS_EVENT_TYPE, text: `Model: ${modelName}` });
  return modelName;
}

async function syncConversationMessages(details: {
  provider: BrowserProvider | null;
  emit: (event: OrchestratorEvent) => void;
  manifestRoot?: string | undefined;
}): Promise<Message[]> {
  const provider = details.provider;

  const isProviderMissing = provider == null;
  if (isProviderMissing) return [];

  const messages = listCapturedMessages(
    await provider.captureAllMessages({
      manifestRoot: details.manifestRoot,
    }),
  );

  const isMessagesEmpty = messages.length === 0;
  if (isMessagesEmpty) return [];

  details.emit({ type: "conversation_synced", messages });
  return messages;
}

async function createNavigateToConversationAction(details: {
  provider: BrowserProvider;
  emit: (event: OrchestratorEvent) => void;
  url: string;
  manifestRoot?: string | undefined;
}): Promise<Message[]> {
  details.emit({ type: STATUS_EVENT_TYPE, text: "Navigating to conversation..." });
  await details.provider.navigateToConversation(details.url);
  const messages = await syncConversationMessages(details);
  details.emit({ type: STATUS_EVENT_TYPE, text: READY_STATUS_LABEL });
  return messages;
}

async function startNewConversationOnPage(details: {
  provider: BrowserProvider;
  emit: (event: OrchestratorEvent) => void;
}): Promise<void> {
  details.emit({ type: STATUS_EVENT_TYPE, text: "Starting new conversation..." });
  await details.provider.newConversation();
  details.emit({ type: "reset" });
  details.emit({ type: STATUS_EVENT_TYPE, text: "Ready — new conversation" });
}

async function createRewindLastPromptAction(details: {
  provider: BrowserProvider;
  emit: (event: OrchestratorEvent) => void;
  replacement?: string;
  manifestRoot?: string | undefined;
}): Promise<Message[]> {
  details.emit({ type: STATUS_EVENT_TYPE, text: "Rewinding last prompt..." });
  await details.provider.rewindLastUserPrompt(details.replacement);
  const messages = await syncConversationMessages(details);
  details.emit({ type: STATUS_EVENT_TYPE, text: "Ready — rewound last prompt" });
  return messages;
}

async function attachFilesAction(details: {
  provider: BrowserProvider;
  paths: string[];
  emit: (event: OrchestratorEvent) => void;
}): Promise<void> {
  await details.provider.removeComposerAttachments?.();

  const isThereNoFileToAttach = details.paths.length === 0;
  if (isThereNoFileToAttach) return;

  details.emit({ type: STATUS_EVENT_TYPE, text: "Attaching files..." });
  await details.provider.attachFilesToPrompt(details.paths);
  details.emit({ type: STATUS_EVENT_TYPE, text: "Files attached." });
}

async function stopReplyAction(details: {
  provider: BrowserProvider;
  emit: (event: OrchestratorEvent) => void;
}): Promise<boolean> {
  const isStopped = await details.provider.stopGenerating();

  if (isStopped) {
    details.emit({ type: STATUS_EVENT_TYPE, text: "Stopped response." });
  } else {
    details.emit({ type: STATUS_EVENT_TYPE, text: "No active response to stop." });
  }

  return isStopped;
}

// A prompt goes out with the connector on in its chat. A failure logs one line and the prompt still sends.
async function turnOnConnectorForPrompt(details: {
  provider: BrowserProvider;
  connectorName: string | null;
  emit: (event: OrchestratorEvent) => void;
}): Promise<void> {
  const readyConnectorName = details.connectorName;
  const isConnectorSetupNotReady = readyConnectorName == null;
  if (isConnectorSetupNotReady) return;

  const turnOnConnectorInChat = details.provider.turnOnConnectorInChat;
  const isTurnOnUnavailable = turnOnConnectorInChat == null;
  if (isTurnOnUnavailable) return;

  try {
    await turnOnConnectorInChat.call(details.provider, readyConnectorName);
  } catch (error) {
    const reason = readErrorMessage(error);
    details.emit({
      type: STATUS_EVENT_TYPE,
      text: `Connector: could not turn on ${readyConnectorName} in this chat (${reason})`,
    });
  }
}

async function executeSendPrompt(
  details: SendPromptDetails & {
    profile: ProviderProfile;
    provider: BrowserProvider | null;
    emit: (event: OrchestratorEvent) => void;
    pushMessage: (message: Message) => void;
    manifestRoot?: string | undefined;
    connectorName: string | null;
  },
): Promise<Message | null> {
  const userMessage = readConversationMessage(USER_ROLE, details.content);
  details.pushMessage(userMessage);
  details.emit({ type: MESSAGE_EVENT_TYPE, message: userMessage });
  details.emit({ type: STATUS_EVENT_TYPE, text: `Waiting for ${details.profile.displayName}...` });
  const promptProvider = requireProviderForPrompt(details.provider, details.emit);

  const isProviderMissing = promptProvider == null;
  if (isProviderMissing) return null;

  const provider: BrowserProvider = promptProvider;

  try {
    const previousAssistantCount = await provider.countAssistantReplies();
    const previousAssistantReply = await provider.captureLastReply({
      manifestRoot: details.manifestRoot,
    });
    // The plugin chip must be added after the prompt text is filled, because filling replaces the draft.
    function turnOnConnectorBeforeSend() {
      return turnOnConnectorForPrompt({
        provider,
        connectorName: details.connectorName,
        emit: details.emit,
      });
    }
    await provider.injectPrompt(details.content, {
      beforeSend: turnOnConnectorBeforeSend,
    });
    details.emit({
      type: STATUS_EVENT_TYPE,
      text: `${details.profile.displayName} is responding...`,
    });
    await provider.waitForReply({
      previousAssistantCount,
      previousLastAssistantText: previousAssistantReply,
      timeout: details.timeoutMilliseconds,
      expectImages: details.expectImages,
    });
    const assistantReply = await provider.captureLastReply({
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
}

async function readConnectorSetupWithinDeadline(details: {
  startSetup: (setupSignal: AbortSignal) => Promise<ConnectorSetupReport>;
  connectorUrl: string;
}): Promise<ConnectorSetupReport> {
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
}

// Setup runs in its own tab, so the chat tab stays free for prompts while setup works.
async function readConnectorSetupInOwnTab(details: {
  chatPage: Page;
  connectorUrl: string;
  startSetup: (setupPage: Page, setupSignal: AbortSignal) => Promise<ConnectorSetupReport>;
}): Promise<ConnectorSetupReport> {
  const setupPage = await details.chatPage.context().newPage();
  try {
    return await readConnectorSetupWithinDeadline({
      startSetup: (setupSignal) => details.startSetup(setupPage, setupSignal),
      connectorUrl: details.connectorUrl,
    });
  } finally {
    await setupPage.close();
  }
}

function readUnsupportedConnectorReport(details: {
  connectorUrl: string;
  displayName: string;
}): ConnectorSetupReport {
  return {
    connectorUrl: details.connectorUrl,
    completed: false,
    steps: [],
    warnings: [
      `${details.displayName} web does not support custom MCP connectors.`,
      "Use @file mentions for read-only repo context, or switch to ChatGPT, Claude, or Grok for full MCP tools.",
    ],
  };
}

async function openConnectorSetup(
  details: ConnectorSetupDetails & {
    profile: ProviderProfile;
    chatPage: Page | null;
    createSetupProvider: (setupPage: Page) => BrowserProvider;
    emit: (event: OrchestratorEvent) => void;
  },
): Promise<ConnectorSetupReport> {
  const isConnectorSetupUnavailable = details.profile.supportsMcpConnector !== true;
  if (isConnectorSetupUnavailable) {
    details.emit({
      type: STATUS_EVENT_TYPE,
      text: "Connector setup is not available for this provider.",
    });
    return readUnsupportedConnectorReport({
      connectorUrl: details.connectorUrl,
      displayName: details.profile.displayName,
    });
  }

  const page = details.chatPage;

  const isPageMissing = page == null;
  if (isPageMissing) {
    details.emit({ type: ERROR_EVENT_TYPE, error: BROWSER_NOT_CONNECTED_MESSAGE });
    return {
      connectorUrl: details.connectorUrl,
      completed: false,
      steps: [],
      warnings: [
        `Browser not connected. Open ${details.profile.displayName} settings manually and add the connector URL.`,
      ],
    };
  }

  const isAutomatic = details.automatic === true;
  if (isAutomatic) {
    details.emit({
      type: STATUS_EVENT_TYPE,
      text: `Syncing ${details.profile.displayName} connector...`,
    });
  } else {
    details.emit({
      type: STATUS_EVENT_TYPE,
      text: `Opening ${details.profile.displayName} connector setup...`,
    });
  }

  const connectorSetup = await readConnectorSetupInOwnTab({
    chatPage: page,
    connectorUrl: details.connectorUrl,
    startSetup: async (setupPage, setupSignal) => {
      const setupMcpConnector = details.createSetupProvider(setupPage).setupMcpConnector;

      const isSetupMissing = setupMcpConnector == null;
      if (isSetupMissing) {
        return readUnsupportedConnectorReport({
          connectorUrl: details.connectorUrl,
          displayName: details.profile.displayName,
        });
      }

      return setupMcpConnector(details.connectorUrl, {
        automatic: details.automatic,
        connectorName: details.connectorName,
        signal: setupSignal,
      });
    },
  });

  const isConnectorSetupReady = connectorSetup.completed;
  if (isConnectorSetupReady) {
    details.emit({ type: STATUS_EVENT_TYPE, text: "Connector ready." });
  } else {
    details.emit({ type: STATUS_EVENT_TYPE, text: "Connector setup needs manual finish." });
  }

  return connectorSetup;
}

export class Orchestrator {
  private readonly emitter = createOrchestratorEmitter();
  private messages: Message[] = [];
  private tab: AttachedTab | null = null;
  private readonly providerId: BridgeProviderId;
  private readonly profile: ProviderProfile;
  private readonly createProviderForPage: (
    providerId: BridgeProviderId,
    page: Page,
  ) => BrowserProvider;
  private readonly manifestRoot: string | undefined;
  private modelName: string;
  private pageHoldTask: Promise<void> | null = null;
  // The connector name once its setup in this session is ready; null until then.
  private readyConnectorName: string | null = null;

  constructor(settings: BridgeSettings, orchestratorSettings: OrchestratorSettings = {}) {
    this.providerId = readProviderIdFrom(settings.provider);
    this.profile = readProviderProfile(this.providerId);
    this.createProviderForPage = orchestratorSettings.createProvider ?? createProvider;
    this.manifestRoot = orchestratorSettings.manifestRoot;

    this.modelName = settings.model ?? this.profile.defaultModel;
  }

  get providerProfile(): ProviderProfile {
    return this.profile;
  }
  get page(): Page | null {
    return this.tab?.page ?? null;
  }
  get model(): string {
    return this.modelName;
  }

  setPage = (page: Page): void => {
    this.tab = { page, provider: this.createProviderForPage(this.providerId, page) };
    void Promise.allSettled([this.detectModel()]);
  };

  // Prompts and file attachments wait until the start ends; connector setup runs in its own tab.
  holdPageUntil = (bootTask: Promise<void>): void => {
    this.pageHoldTask = bootTask;
  };

  subscribe = (listener: (event: OrchestratorEvent) => void): (() => void) => {
    return this.emitter.subscribe(listener);
  };

  private emit = (event: OrchestratorEvent): void => {
    this.emitter.emit(event);
  };

  detectModel = async (): Promise<string> => {
    this.modelName = await detectModel({
      provider: this.tab?.provider ?? null,
      modelName: this.modelName,
      emit: this.emit,
    });

    return this.modelName;
  };

  start = async (): Promise<void> => {
    this.messages = await syncConversationMessages({
      provider: this.tab?.provider ?? null,
      emit: this.emit,
      manifestRoot: this.manifestRoot,
    });

    void Promise.allSettled([this.detectModel()]);

    this.emit({ type: STATUS_EVENT_TYPE, text: "Bridge ready. Type a prompt to begin." });
  };

  sendPrompt = async (details: SendPromptDetails): Promise<Message | null> => {
    await this.pageHoldTask;
    return executeSendPrompt({
      ...details,
      profile: this.profile,
      provider: this.tab?.provider ?? null,
      emit: this.emit,
      manifestRoot: this.manifestRoot,
      connectorName: this.readyConnectorName,
      pushMessage: (message) => {
        this.messages.push(message);
      },
    });
  };

  listConversations = async (settings?: { readonly orphans?: boolean }) => {
    const tab = this.tab;
    const isTabMissing = tab == null;

    const isOrphanScanWithoutPage = isTabMissing && settings?.orphans === true;
    if (isOrphanScanWithoutPage) throw new Error("No ChatGPT page is open to read loose chats.");

    if (isTabMissing) return [];

    return tab.provider.readSidebarConversations(settings);
  };

  searchConversations = async (details: {
    query: string;
    limit?: number;
  }): Promise<ConversationSearchReport[]> => {
    const tab = this.tab;

    const isTabMissing = tab == null;
    if (isTabMissing) return [];

    return searchConversations({
      provider: tab.provider,
      query: details.query,
      limit: details.limit,
    });
  };

  listModels = async (): Promise<ModelOption[]> => {
    const tab = requireTab(this.tab, this.emit);

    const isTabMissing = tab == null;
    if (isTabMissing) return [];

    return listModelsAction({
      provider: tab.provider,
      emit: this.emit,
      setModelName: (name) => {
        this.modelName = name;
      },
    });
  };

  switchModel = async (query: string): Promise<string> => {
    const tab = requireTab(this.tab, this.emit);

    const isTabMissing = tab == null;
    if (isTabMissing) return this.modelName;

    this.modelName = await switchModelAction({
      provider: tab.provider,
      query,
      emit: this.emit,
    });
    return this.modelName;
  };

  navigateToConversation = async (url: string): Promise<void> => {
    const tab = requireTab(this.tab, this.emit);

    const isTabMissing = tab == null;
    if (isTabMissing) return;

    if (isSameChatGptConversation(tab.page.url(), url)) return;

    this.messages = await createNavigateToConversationAction({
      provider: tab.provider,
      emit: this.emit,
      url,
      manifestRoot: this.manifestRoot,
    });
  };

  openNewConversation = async (): Promise<void> => {
    const tab = requireTab(this.tab, this.emit);

    const isTabMissing = tab == null;
    if (isTabMissing) return;

    await startNewConversationOnPage({ provider: tab.provider, emit: this.emit });
    this.messages = [];
  };

  rewindLastPrompt = async (replacement?: string): Promise<void> => {
    const tab = requireTab(this.tab, this.emit);

    const isTabMissing = tab == null;
    if (isTabMissing) return;

    this.messages = await createRewindLastPromptAction({
      provider: tab.provider,
      emit: this.emit,
      replacement,
      manifestRoot: this.manifestRoot,
    });
  };

  stopReply = async (): Promise<boolean> => {
    const tab = requireTab(this.tab, this.emit);

    const isTabMissing = tab == null;
    if (isTabMissing) return false;

    return stopReplyAction({ provider: tab.provider, emit: this.emit });
  };

  attachFiles = async (paths: string[]): Promise<void> => {
    await this.pageHoldTask;
    const tab = requireTab(this.tab, this.emit);

    const isTabMissing = tab == null;
    if (isTabMissing) return;

    await attachFilesAction({ provider: tab.provider, paths, emit: this.emit });
  };

  openConnectorSetup = async (details: ConnectorSetupDetails): Promise<ConnectorSetupReport> => {
    const connectorSetup = await openConnectorSetup({
      ...details,
      profile: this.profile,
      chatPage: this.page,
      createSetupProvider: (setupPage) => this.createProviderForPage(this.providerId, setupPage),
      emit: this.emit,
    });

    const isConnectorSetupReady = connectorSetup.completed;
    if (isConnectorSetupReady) {
      this.readyConnectorName = details.connectorName ?? DEFAULT_CONNECTOR_NAME;
    }

    return connectorSetup;
  };
}
