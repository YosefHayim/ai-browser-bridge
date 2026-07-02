import type { Page } from "playwright";
import type { ConnectorSetupOptions, ConnectorSetupResult, ModelOption } from "../domain/types.ts";

/** Supported browser provider identifiers. */
export type BridgeProviderId = "chatgpt" | "gemini";

/** Options for waiting on an assistant response in the browser. */
export interface ResponseWaitOptions {
  /** Maximum wait time in milliseconds. */
  timeout?: number;
  /** Assistant message count before the prompt was sent. */
  previousAssistantCount?: number;
  /** Last assistant text before the prompt was sent. */
  previousLastAssistantText?: string;
}

/** Browser automation surface shared by ChatGPT and Gemini web adapters. */
export interface BrowserProvider {
  /** Provider identifier used in config and CLI. */
  id: BridgeProviderId;
  /** Origin hostname used to locate an existing tab. */
  origin: string;
  /** Default URL opened when no provider tab exists. */
  defaultUrl: string;
  /** Fallback model label before detection runs. */
  defaultModel: string;
  /** Human-readable provider name for logs. */
  displayName: string;
  /** Composer selector waited on after navigation. */
  composerSelector: string;
  /** Whether MCP connector setup is supported. */
  supportsMcpConnector: boolean;
  assertSignedIn(page: Page): Promise<void>;
  injectPrompt(page: Page, text: string): Promise<void>;
  waitForResponse(page: Page, options?: number | ResponseWaitOptions): Promise<void>;
  captureLastResponse(page: Page): Promise<string>;
  countAssistantResponses(page: Page): Promise<number>;
  captureAllMessages(page: Page): Promise<Array<{ role: string; content: string }>>;
  readSidebarConversations(page: Page): Promise<Array<{ id: string; title: string; url: string }>>;
  navigateToConversation(page: Page, url: string): Promise<void>;
  newConversation(page: Page): Promise<void>;
  detectCurrentModel(page: Page): Promise<string>;
  listAvailableModels(page: Page): Promise<ModelOption[]>;
  selectModel(page: Page, query: string): Promise<string>;
  rewindLastUserPrompt(page: Page, replacement?: string): Promise<void>;
  stopGenerating(page: Page, timeout?: number): Promise<boolean>;
  attachFilesToPrompt(page: Page, paths: string[]): Promise<void>;
  isLikelyModelLabel(value: string): boolean;
  setupMcpConnector?(
    page: Page,
    url: string,
    options?: ConnectorSetupOptions,
  ): Promise<ConnectorSetupResult>;
}
