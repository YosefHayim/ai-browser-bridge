import type { Page } from "playwright";
import type { BridgeSettings } from "@/bridge-types.ts";
import type { ConnectorSetupReport, ModelOption } from "@/connector-types.ts";
import type { ConversationSearchReport } from "@/conversation-catalog/conversation-catalog-schemas.ts";
import { searchConversations } from "@/conversation-catalog/conversation-search.ts";
import type { Message, ToolReport } from "@/message-types.ts";
import { findModelProfile } from "@/model-profiles/model-lookup.ts";
import { OrchestratorEmitter } from "@/orchestrator/orchestrator-emitter.ts";
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
const STATUS_EVENT_TYPE = "status";
const ERROR_EVENT_TYPE = "error";
const READY_STATUS_LABEL = "Ready";
const BROWSER_NOT_CONNECTED_MESSAGE = "Browser not connected.";

export interface SendPromptDetails {
  content: string;
  timeoutMilliseconds?: number;
  expectImages?: number;
}

export interface ConnectorSetupDetails {
  connectorUrl: string;
  automatic?: boolean;
}

export interface OrchestratorSettings {
  manifestRoot?: string | undefined;
  createProvider?: (providerId: BridgeProviderId, page: Page) => BrowserProvider;
}

interface AttachedTab {
  page: Page;
  provider: BrowserProvider;
}

interface CapturedMessage {
  role: string;
  content: string;
}

interface ConversationMessageText {
  role: "user" | "assistant";
  content: string;
}

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

function createMessage(role: Message["role"], content: string): Message {
  return { id: crypto.randomUUID(), role, content, timestamp: Date.now() };
}

function hasConversationText(message: CapturedMessage): message is ConversationMessageText {
  const isConversationRole = message.role === "user" || message.role === "assistant";
  if (!isConversationRole) return false;

  const hasText = message.content.trim().length > 0;
  return hasText;
}

function createSyncedMessage(message: ConversationMessageText): Message {
  return {
    id: `dom-${crypto.randomUUID()}`,
    role: message.role,
    content: message.content,
    timestamp: Date.now(),
  };
}

function listCapturedMessages(capturedMessages: CapturedMessage[]): Message[] {
  return capturedMessages.filter(hasConversationText).map(createSyncedMessage);
}

function readUnsupportedConnectorReport(
  connectorUrl: string,
  profile: ProviderProfile,
): ConnectorSetupReport {
  return {
    connectorUrl,
    completed: false,
    steps: [],
    warnings: [
      `${profile.displayName} web does not support custom MCP connectors.`,
      "Use @file mentions for read-only repo context, or switch to ChatGPT, Claude, or Grok for full MCP tools.",
    ],
  };
}

async function readConnectorSetupWithinDeadline(
  connectorUrl: string,
  startSetup: (setupSignal: AbortSignal) => Promise<ConnectorSetupReport>,
): Promise<ConnectorSetupReport> {
  const connectorSetupTimeoutMilliseconds = 120_000;
  const deadlineSignal = AbortSignal.timeout(connectorSetupTimeoutMilliseconds);

  function rejectAtDeadline(_fulfill: unknown, reject: (reason: Error) => void): void {
    function rejectWithDeadlineError(): void {
      const deadlineSeconds = connectorSetupTimeoutMilliseconds / 1000;
      reject(new Error(`Connector setup did not finish within ${deadlineSeconds} seconds.`));
    }

    deadlineSignal.addEventListener("abort", rejectWithDeadlineError, { once: true });
  }

  const deadline = new Promise<never>(rejectAtDeadline);

  try {
    const setupTask = startSetup(deadlineSignal);
    return await Promise.race([setupTask, deadline]);
  } catch (error) {
    const failureReason = readErrorMessage(error);
    return { connectorUrl, completed: false, steps: [], warnings: [failureReason] };
  }
}

export class Orchestrator {
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

  constructor(
    settings: BridgeSettings,
    orchestratorSettings: OrchestratorSettings = {},
    private readonly emitter = new OrchestratorEmitter(),
  ) {
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
    void this.detectModelInBackground();
  };

  // Prompts and file attachments wait until the start ends; connector setup runs in its own tab.
  holdPageUntil = (bootTask: Promise<void>): void => {
    this.pageHoldTask = bootTask;
  };

  subscribe = (listener: (event: OrchestratorEvent) => void): (() => void) => {
    return this.emitter.subscribe(listener);
  };

  detectModel = async (): Promise<string> => {
    const provider = this.tab?.provider;

    const isProviderMissing = provider == null;
    if (isProviderMissing) return this.modelName;

    // Read the live model: a persisted label can be another provider's model after a --provider switch.
    const detectedModelName = await provider.detectCurrentModel();
    this.emitStatus(`Model: ${detectedModelName}`);
    this.emitModelChanged(detectedModelName);
    this.modelName = detectedModelName;

    return this.modelName;
  };

  start = async (): Promise<void> => {
    this.messages = await this.syncMessages();
    void this.detectModelInBackground();
    this.emitStatus("Bridge ready. Type a prompt to begin.");
  };

  sendPrompt = async (details: SendPromptDetails): Promise<Message | null> => {
    await this.pageHoldTask;

    const userMessage = createMessage("user", details.content);
    this.messages.push(userMessage);
    this.emitter.emit({ type: MESSAGE_EVENT_TYPE, message: userMessage });
    this.emitStatus(`Waiting for ${this.profile.displayName}...`);

    const provider = this.tab?.provider;

    const isProviderMissing = provider == null;
    if (isProviderMissing) {
      this.emitter.emit({
        type: ERROR_EVENT_TYPE,
        error: "Browser not connected. Cannot send prompt.",
      });
      return null;
    }

    try {
      return await this.sendPromptToProvider(provider, details);
    } catch (error) {
      const errorMessage = readErrorMessage(error);
      this.emitter.emit({ type: ERROR_EVENT_TYPE, error: errorMessage });
      return null;
    }
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
    const tab = this.readTab();

    const isTabMissing = tab == null;
    if (isTabMissing) return [];

    const models = await tab.provider.listAvailableModels();
    const selectedModel = models.find(isSelectedModel);

    const isSelectedModelMissing = selectedModel == null;
    if (isSelectedModelMissing) return models;

    this.emitModelChanged(selectedModel.label);
    this.modelName = selectedModel.label;

    return models;
  };

  switchModel = async (query: string): Promise<string> => {
    const tab = this.readTab();

    const isTabMissing = tab == null;
    if (isTabMissing) return this.modelName;

    this.emitStatus(`Switching model to ${query}...`);
    const switchedModelName = await tab.provider.selectModel(query);
    this.emitModelChanged(switchedModelName);
    this.emitStatus(`Model: ${switchedModelName}`);
    this.modelName = switchedModelName;

    return this.modelName;
  };

  navigateToConversation = async (url: string): Promise<void> => {
    const tab = this.readTab();

    const isTabMissing = tab == null;
    if (isTabMissing) return;

    if (isSameChatGptConversation(tab.page.url(), url)) return;

    this.emitStatus("Navigating to conversation...");
    await tab.provider.navigateToConversation(url);
    this.messages = await this.syncMessages();
    this.emitStatus(READY_STATUS_LABEL);
  };

  openNewConversation = async (): Promise<void> => {
    const tab = this.readTab();

    const isTabMissing = tab == null;
    if (isTabMissing) return;

    this.emitStatus("Starting new conversation...");
    await tab.provider.newConversation();
    this.emitter.emit({ type: "reset" });
    this.emitStatus("Ready — new conversation");
    this.messages = [];
  };

  rewindLastPrompt = async (replacement?: string): Promise<void> => {
    const tab = this.readTab();

    const isTabMissing = tab == null;
    if (isTabMissing) return;

    this.emitStatus("Rewinding last prompt...");
    await tab.provider.rewindLastUserPrompt(replacement);
    this.messages = await this.syncMessages();
    this.emitStatus("Ready — rewound last prompt");
  };

  stopReply = async (): Promise<boolean> => {
    const tab = this.readTab();

    const isTabMissing = tab == null;
    if (isTabMissing) return false;

    const isStopped = await tab.provider.stopGenerating();
    if (isStopped) {
      this.emitStatus("Stopped response.");
      return true;
    }

    this.emitStatus("No active response to stop.");
    return false;
  };

  attachFiles = async (paths: string[]): Promise<void> => {
    await this.pageHoldTask;
    const tab = this.readTab();

    const isTabMissing = tab == null;
    if (isTabMissing) return;

    await tab.provider.removeComposerAttachments?.();

    const isThereNoFileToAttach = paths.length === 0;
    if (isThereNoFileToAttach) return;

    this.emitStatus("Attaching files...");
    await tab.provider.attachFilesToPrompt(paths);
    this.emitStatus("Files attached.");
  };

  openConnectorSetup = async (details: ConnectorSetupDetails): Promise<ConnectorSetupReport> => {
    const connectorSetup = await this.runConnectorSetup(details);
    this.emitStatus(
      connectorSetup.completed ? "Connector ready." : "Connector setup needs manual finish.",
    );

    const isConnectorSetupReady = connectorSetup.completed;
    if (isConnectorSetupReady) this.readyConnectorName = DEFAULT_CONNECTOR_NAME;

    return connectorSetup;
  };

  private emitStatus = (text: string): void => {
    this.emitter.emit({ type: STATUS_EVENT_TYPE, text });
  };

  private emitModelChanged = (modelName: string): void => {
    const modelProfile = findModelProfile(modelName);
    this.emitter.emit({
      type: MODEL_CHANGED_EVENT_TYPE,
      model: modelName,
      contextLimit: modelProfile.contextWindow,
    });
  };

  private readTab = (): AttachedTab | null => {
    const tab = this.tab;

    const hasTab = tab != null;
    if (hasTab) return tab;

    this.emitter.emit({ type: ERROR_EVENT_TYPE, error: BROWSER_NOT_CONNECTED_MESSAGE });
    return null;
  };

  private detectModelInBackground = async (): Promise<void> => {
    try {
      await this.detectModel();
    } catch (error) {
      const reason = readErrorMessage(error);
      this.emitStatus(`Model: could not read the current model (${reason})`);
    }
  };

  private syncMessages = async (): Promise<Message[]> => {
    const provider = this.tab?.provider;

    const isProviderMissing = provider == null;
    if (isProviderMissing) return [];

    const capturedMessages = await provider.captureAllMessages({
      manifestRoot: this.manifestRoot,
    });
    const messages = listCapturedMessages(capturedMessages);

    const isMessagesEmpty = messages.length === 0;
    if (isMessagesEmpty) return [];

    this.emitter.emit({ type: "conversation_synced", messages });
    return messages;
  };

  // A prompt goes out with the connector on in its chat. A failure logs one line and the prompt still sends.
  private turnOnConnectorForPrompt = async (provider: BrowserProvider): Promise<void> => {
    const connectorName = this.readyConnectorName;
    const isConnectorSetupNotReady = connectorName == null;
    if (isConnectorSetupNotReady) return;

    const isTurnOnUnavailable = provider.turnOnConnectorInChat == null;
    if (isTurnOnUnavailable) return;

    try {
      await provider.turnOnConnectorInChat?.(connectorName);
    } catch (error) {
      const reason = readErrorMessage(error);
      this.emitStatus(`Connector: could not turn on ${connectorName} in this chat (${reason})`);
    }
  };

  private sendPromptToProvider = async (
    provider: BrowserProvider,
    details: SendPromptDetails,
  ): Promise<Message> => {
    const previousAssistantCount = await provider.countAssistantReplies();
    const previousAssistantReply = await provider.captureLastReply({
      manifestRoot: this.manifestRoot,
    });

    // The plugin chip must be added after the prompt text is filled, because filling replaces the draft.
    const turnOnConnectorBeforeSend = (): Promise<void> => {
      return this.turnOnConnectorForPrompt(provider);
    };
    await provider.injectPrompt(details.content, { beforeSend: turnOnConnectorBeforeSend });
    this.emitStatus(`${this.profile.displayName} is responding...`);

    await provider.waitForReply({
      previousAssistantCount,
      previousLastAssistantText: previousAssistantReply,
      timeout: details.timeoutMilliseconds,
      expectImages: details.expectImages,
    });
    const assistantReply = await provider.captureLastReply({ manifestRoot: this.manifestRoot });

    const assistantMessage = createMessage("assistant", assistantReply);
    this.messages.push(assistantMessage);
    this.emitter.emit({ type: MESSAGE_EVENT_TYPE, message: assistantMessage });
    this.emitStatus(READY_STATUS_LABEL);

    return assistantMessage;
  };

  private runConnectorSetup = async (
    details: ConnectorSetupDetails,
  ): Promise<ConnectorSetupReport> => {
    const displayName = this.profile.displayName;

    const isConnectorSetupUnavailable = this.profile.supportsMcpConnector !== true;
    if (isConnectorSetupUnavailable) {
      this.emitStatus("Connector setup is not available for this provider.");
      return readUnsupportedConnectorReport(details.connectorUrl, this.profile);
    }

    const chatPage = this.page;

    const isChatPageMissing = chatPage == null;
    if (isChatPageMissing) {
      this.emitter.emit({ type: ERROR_EVENT_TYPE, error: BROWSER_NOT_CONNECTED_MESSAGE });
      return {
        connectorUrl: details.connectorUrl,
        completed: false,
        steps: [],
        warnings: [
          `Browser not connected. Open ${displayName} settings manually and add the connector URL.`,
        ],
      };
    }

    const isAutomatic = details.automatic === true;
    if (isAutomatic) this.emitStatus(`Syncing ${displayName} connector...`);
    if (!isAutomatic) this.emitStatus(`Opening ${displayName} connector setup...`);

    // Setup runs in its own tab, so the chat tab stays free for prompts while setup works.
    const setupPage = await chatPage.context().newPage();
    try {
      const startSetup = (setupSignal: AbortSignal): Promise<ConnectorSetupReport> => {
        return this.startConnectorSetup(details, setupPage, setupSignal);
      };
      return await readConnectorSetupWithinDeadline(details.connectorUrl, startSetup);
    } finally {
      await setupPage.close();
    }
  };

  private startConnectorSetup = async (
    details: ConnectorSetupDetails,
    setupPage: Page,
    setupSignal: AbortSignal,
  ): Promise<ConnectorSetupReport> => {
    const setupProvider = this.createProviderForPage(this.providerId, setupPage);

    const isSetupMissing = setupProvider.setupMcpConnector == null;
    if (isSetupMissing) return readUnsupportedConnectorReport(details.connectorUrl, this.profile);

    const connectorSetup = await setupProvider.setupMcpConnector?.(details.connectorUrl, {
      automatic: details.automatic,
      signal: setupSignal,
    });

    const isConnectorSetupMissing = connectorSetup == null;
    if (isConnectorSetupMissing) {
      return readUnsupportedConnectorReport(details.connectorUrl, this.profile);
    }

    return connectorSetup;
  };
}

function isSelectedModel(model: ModelOption): boolean {
  return model.selected === true;
}
