import type { Page } from "playwright";
import type { BridgeConfig, ConnectorSetupOptions, ConnectorSetupResult, Message, ModelOption, ToolResult } from "../types/types.ts";
import {
  injectPrompt,
  waitForResponse,
  captureLastResponse,
  countAssistantResponses,
  captureAllMessages,
  readSidebarConversations,
  navigateToConversation as navigatePage,
  newConversation as newPage,
  detectCurrentModel,
  listAvailableModels,
  selectModel,
  rewindLastUserPrompt,
  stopGenerating,
  attachFilesToPrompt,
  setupMcpConnectorInChatGpt,
  isLikelyModelLabel,
} from "../browser/chatgpt-page.ts";
import { findModelProfile } from "./model-catalog.ts";

type OrchestratorEvent =
  | { type: "message"; message: Message }
  | { type: "tool_call"; name: string; arguments: Record<string, unknown> }
  | { type: "tool_result"; name: string; result: ToolResult }
  | { type: "status"; text: string }
  | { type: "error"; error: string }
  | { type: "context_update"; count: number; limit: number }
  | { type: "conversation_synced"; messages: Message[] }
  | { type: "model_changed"; model: string; contextLimit: number }
  | { type: "reset" };

type OrchestratorListener = (event: OrchestratorEvent) => void;

/**
 * Coordinates browser automation, MCP server, and terminal UI.
 *
 * Accepts a Playwright Page (already navigated to ChatGPT) and
 * uses it to inject prompts, wait for responses, and capture text.
 */
export class Orchestrator {
  private listeners: OrchestratorListener[] = [];
  private messages: Message[] = [];
  private page: Page | null = null;

  private modelName: string;

  constructor(private _config: BridgeConfig) {
    this.modelName = _config.model ?? "ChatGPT";
  }

  setPage(page: Page): void {
    this.page = page;
    this.detectModel().catch(() => {});
  }

  /** Detect the current ChatGPT model and store it. */
  async detectModel(): Promise<string> {
    if (!this.page) return this.modelName;
    const detected = await detectCurrentModel(this.page);
    // Adopt a real detected model immediately. When detection only yields the
    // "ChatGPT" placeholder, keep an existing real name but discard junk (e.g. a
    // stale config value), so a bad label can never persist across runs.
    if (detected !== "ChatGPT") {
      this.modelName = detected;
    } else if (!isLikelyModelLabel(this.modelName)) {
      this.modelName = "ChatGPT";
    }
    const profile = findModelProfile(this.modelName);
    this.emit({ type: "status", text: `Model: ${this.modelName}` });
    this.emit({ type: "model_changed", model: this.modelName, contextLimit: profile.contextWindow });
    return this.modelName;
  }

  get model(): string {
    return this.modelName;
  }

  on(fn: OrchestratorListener): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  private emit(event: OrchestratorEvent): void {
    for (const fn of this.listeners) {
      fn(event);
    }
  }

  async start(): Promise<void> {
    await this.syncConversationMessages();
    // Model detection opens the model menu, which can take seconds against the
    // live UI. It only feeds the context-counter's window size (metadata), so it
    // must never gate the round-trip — run it in the background.
    this.detectModel().catch(() => {});
    this.emit({ type: "status", text: "Bridge ready. Type a prompt to begin." });
  }

  /**
   * Send a user prompt: inject into ChatGPT browser, wait for the response, capture it.
   *
   * Emits `message`/`status`/`error` events for the live TUI, and also returns the
   * captured assistant message so non-interactive callers (the headless `bridge ask`
   * command) can read the reply directly. Returns null if the browser is not
   * connected or the round-trip fails. `opts.timeoutMs` overrides the default
   * response wait (useful for slow turns like image generation).
   */
  async sendPrompt(content: string, opts?: { timeoutMs?: number }): Promise<Message | null> {
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      timestamp: Date.now(),
    };
    this.messages.push(userMsg);
    this.emit({ type: "message", message: userMsg });
    this.emit({ type: "status", text: "Waiting for ChatGPT..." });

    if (!this.page) {
      this.emit({ type: "error", error: "Browser not connected. Cannot send prompt." });
      return null;
    }

    try {
      const previousAssistantCount = await countAssistantResponses(this.page);
      const previousLastAssistantText = await captureLastResponse(this.page);
      await injectPrompt(this.page, content);
      this.emit({ type: "status", text: "ChatGPT is responding..." });

      await waitForResponse(this.page, { previousAssistantCount, previousLastAssistantText, timeout: opts?.timeoutMs });

      const responseText = await captureLastResponse(this.page);

      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: responseText,
        timestamp: Date.now(),
      };
      this.messages.push(assistantMsg);
      this.emit({ type: "message", message: assistantMsg });
      this.emit({ type: "status", text: "Ready" });
      return assistantMsg;
    } catch (err) {
      this.emit({
        type: "error",
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  /** Read the conversation list from ChatGPT's sidebar. */
  async listConversations(): Promise<Array<{ id: string; title: string; url: string }>> {
    if (!this.page) return [];
    return readSidebarConversations(this.page);
  }

  /** List models exposed by the browser model switcher. */
  async listModels(): Promise<ModelOption[]> {
    if (!this.page) {
      this.emit({ type: "error", error: "Browser not connected." });
      return [];
    }
    const models = await listAvailableModels(this.page);
    const selected = models.find((model) => model.selected);
    if (selected) {
      this.modelName = selected.label;
      const profile = findModelProfile(this.modelName);
      this.emit({ type: "model_changed", model: this.modelName, contextLimit: profile.contextWindow });
    }
    return models;
  }

  /** Switch ChatGPT to a model exposed by the browser model switcher. */
  async switchModel(query: string): Promise<string> {
    if (!this.page) {
      this.emit({ type: "error", error: "Browser not connected." });
      return this.modelName;
    }
    this.emit({ type: "status", text: `Switching model to ${query}...` });
    this.modelName = await selectModel(this.page, query);
    const profile = findModelProfile(this.modelName);
    this.emit({ type: "model_changed", model: this.modelName, contextLimit: profile.contextWindow });
    this.emit({ type: "status", text: `Model: ${this.modelName}` });
    return this.modelName;
  }

  /** Navigate the browser to an existing conversation. */
  async navigateToConversation(url: string): Promise<void> {
    if (!this.page) {
      this.emit({ type: "error", error: "Browser not connected." });
      return;
    }
    this.emit({ type: "status", text: `Navigating to conversation...` });
    await navigatePage(this.page, url);
    await this.syncConversationMessages();
    this.emit({ type: "status", text: "Ready" });
  }

  /** Open a fresh ChatGPT conversation. */
  async newConversation(): Promise<void> {
    if (!this.page) {
      this.emit({ type: "error", error: "Browser not connected." });
      return;
    }
    this.emit({ type: "status", text: "Starting new conversation..." });
    await newPage(this.page);
    this.messages = [];
    this.emit({ type: "reset" });
    this.emit({ type: "status", text: "Ready — new conversation" });
  }

  /** Edit the last user message and resubmit it through ChatGPT's browser UI. */
  async rewindLastPrompt(replacement?: string): Promise<void> {
    if (!this.page) {
      this.emit({ type: "error", error: "Browser not connected." });
      return;
    }
    this.emit({ type: "status", text: "Rewinding last prompt..." });
    await rewindLastUserPrompt(this.page, replacement);
    await this.syncConversationMessages();
    this.emit({ type: "status", text: "Ready — rewound last prompt" });
  }

  /** Stop the active ChatGPT response stream when possible. */
  async stopResponse(): Promise<boolean> {
    if (!this.page) {
      this.emit({ type: "error", error: "Browser not connected." });
      return false;
    }
    const stopped = await stopGenerating(this.page);
    this.emit({ type: "status", text: stopped ? "Stopped response." : "No active response to stop." });
    return stopped;
  }

  /** Attach local files to the current ChatGPT composer. */
  async attachFiles(paths: string[]): Promise<void> {
    if (!this.page) {
      this.emit({ type: "error", error: "Browser not connected." });
      return;
    }
    this.emit({ type: "status", text: "Attaching files..." });
    await attachFilesToPrompt(this.page, paths);
    this.emit({ type: "status", text: "Files attached." });
  }

  /** Open ChatGPT settings and best-effort fill the Developer Mode connector form. */
  async openConnectorSetup(connectorUrl: string, options?: ConnectorSetupOptions): Promise<ConnectorSetupResult> {
    if (!this.page) {
      const result: ConnectorSetupResult = {
        connectorUrl,
        completed: false,
        steps: [],
        warnings: ["Browser not connected. Open ChatGPT settings manually and paste the connector URL."],
      };
      this.emit({ type: "error", error: "Browser not connected." });
      return result;
    }

    this.emit({ type: "status", text: options?.automatic ? "Syncing ChatGPT connector..." : "Opening ChatGPT connector setup..." });
    const result = await setupMcpConnectorInChatGpt(this.page, connectorUrl, options);
    this.emit({ type: "status", text: result.completed ? "Connector ready." : "Connector setup needs manual finish." });
    return result;
  }

  async stop(): Promise<void> {
    this.emit({ type: "status", text: "Shutting down..." });
  }

  get currentMessages(): Message[] {
    return this.messages;
  }

  private async syncConversationMessages(): Promise<void> {
    if (!this.page) return;

    const captured = await captureAllMessages(this.page);
    const messages: Message[] = captured
      .filter((message): message is { role: "user" | "assistant"; content: string } =>
        (message.role === "user" || message.role === "assistant") && message.content.trim().length > 0,
      )
      .map((message, index) => ({
        id: `dom-${index}-${crypto.randomUUID()}`,
        role: message.role,
        content: message.content,
        timestamp: Date.now(),
      }));

    if (messages.length === 0) return;

    this.messages = messages;
    this.emit({ type: "conversation_synced", messages });
  }
}
