import type { Page } from "playwright";
import type { BridgeConfig, Message, ModelOption, ConnectorSetupResult } from "../domain/types.ts";
import { getBrowserProvider, type BrowserProvider } from "../providers/create-provider.factory.ts";
import type { OrchestratorEvent, SendPromptInput, ConnectorSetupInput } from "./orchestrator.types.ts";
import { createOrchestratorEmitter, requirePage } from "./orchestrator.emitter.ts";
import { detectModel, listModelsAction, switchModelAction } from "./orchestrator.model.ts";
import { attachFilesAction, navigateToConversationAction, newConversationAction, rewindLastPromptAction, stopResponseAction, syncConversationMessages } from "./orchestrator.conversation.ts";
import { executeSendPrompt } from "./orchestrator-send-prompt.ts";
import { openConnectorSetup } from "./orchestrator-connector-setup.ts";
import { classEmit, detectCtx, syncCtx } from "./orchestrator.class.ctx.ts";

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
  setPage(page: Page): void { this.page = page; this.detectModel().catch(() => {}); }
  on(fn: (event: OrchestratorEvent) => void): () => void { return this.emitter.on(fn); }
  async detectModel(): Promise<string> {
    const emit = classEmit(this.emitter.emit.bind(this.emitter));
    this.modelName = await detectModel(detectCtx({ page: this.page, provider: this.provider, modelName: this.modelName, emit }));
    return this.modelName;
  }

  async start(): Promise<void> {
    const emit = classEmit(this.emitter.emit.bind(this.emitter));
    this.messages = await syncConversationMessages(syncCtx({ page: this.page, provider: this.provider, emit }));
    this.detectModel().catch(() => {});
    emit({ type: "status", text: "Bridge ready. Type a prompt to begin." });
  }

  async sendPrompt(input: SendPromptInput): Promise<Message | null> {
    const emit = classEmit(this.emitter.emit.bind(this.emitter));
    return executeSendPrompt({ ...input, page: this.page, provider: this.provider, emit, pushMessage: (m) => { this.messages.push(m); } });
  }

  async listConversations() { return this.page ? this.provider.readSidebarConversations(this.page) : []; }
  async listModels(): Promise<ModelOption[]> {
    const emit = classEmit(this.emitter.emit.bind(this.emitter));
    const page = requirePage(this.page, emit);
    return page ? listModelsAction({ page, provider: this.provider, emit, setModelName: (name) => { this.modelName = name; } }) : [];
  }

  async switchModel(query: string): Promise<string> {
    const emit = classEmit(this.emitter.emit.bind(this.emitter));
    const page = requirePage(this.page, emit);
    if (!page) return this.modelName;
    this.modelName = await switchModelAction({ page, provider: this.provider, query, emit });
    return this.modelName;
  }

  async navigateToConversation(url: string): Promise<void> {
    const emit = classEmit(this.emitter.emit.bind(this.emitter));
    const page = requirePage(this.page, emit);
    if (page) this.messages = await navigateToConversationAction({ ...syncCtx({ page: this.page, provider: this.provider, emit }), page, url });
  }

  async newConversation(): Promise<void> {
    const emit = classEmit(this.emitter.emit.bind(this.emitter));
    const page = requirePage(this.page, emit);
    if (!page) return;
    await newConversationAction({ page, provider: this.provider, emit });
    this.messages = [];
  }

  async rewindLastPrompt(replacement?: string): Promise<void> {
    const emit = classEmit(this.emitter.emit.bind(this.emitter));
    const page = requirePage(this.page, emit);
    if (page) this.messages = await rewindLastPromptAction({ ...syncCtx({ page: this.page, provider: this.provider, emit }), page, replacement });
  }

  async stopResponse(): Promise<boolean> {
    const emit = classEmit(this.emitter.emit.bind(this.emitter));
    const page = requirePage(this.page, emit);
    return page ? stopResponseAction({ page, provider: this.provider, emit }) : false;
  }

  async attachFiles(paths: string[]): Promise<void> {
    const emit = classEmit(this.emitter.emit.bind(this.emitter));
    const page = requirePage(this.page, emit);
    if (page) await attachFilesAction({ page, provider: this.provider, paths, emit });
  }

  async openConnectorSetup(input: ConnectorSetupInput): Promise<ConnectorSetupResult> {
    return openConnectorSetup({ ...input, page: this.page, provider: this.provider, emit: classEmit(this.emitter.emit.bind(this.emitter)) });
  }

  async stop(): Promise<void> { this.emitter.emit({ type: "status", text: "Shutting down..." }); }
}
