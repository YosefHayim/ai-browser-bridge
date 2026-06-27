import type { Message, ToolResult } from "../domain/types.ts";

/** Options for sending a prompt through the orchestrator. */
export interface SendPromptOptions {
  /** Override response wait timeout in milliseconds. */
  timeoutMs?: number;
}

/** Input for {@link Orchestrator.sendPrompt}. */
export interface SendPromptInput {
  /** User prompt text to inject. */
  content: string;
  /** Override response wait timeout in milliseconds. */
  timeoutMs?: number;
}

/** Input for {@link Orchestrator.openConnectorSetup}. */
export interface ConnectorSetupInput {
  /** MCP connector URL to register. */
  connectorUrl: string;
  /** Whether to run setup automatically. */
  automatic?: boolean;
  /** Optional connector name override. */
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
