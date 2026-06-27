/** Chat message captured from the browser conversation. */
export interface Message {
  /** Stable message identifier. */
  id: string;
  /** Speaker role in the conversation. */
  role: "user" | "assistant";
  /** Plain-text message body. */
  content: string;
  /** Unix timestamp in milliseconds. */
  timestamp: number;
  /** Tool calls emitted by the assistant, when present. */
  toolCalls?: ToolCall[];
}

/** Assistant-issued tool invocation. */
export interface ToolCall {
  /** Tool call identifier. */
  id: string;
  /** Registered MCP tool name. */
  name: string;
  /** Parsed JSON arguments for the tool. */
  arguments: Record<string, unknown>;
}

/** Result returned from an MCP tool handler. */
export interface ToolResult {
  /** Whether the tool completed successfully. */
  ok: boolean;
  /** Serialized output shown to the model. */
  output: string;
  /** Optional error message when `ok` is false. */
  error?: string;
}

/** Sidebar conversation entry from the provider UI. */
export interface Conversation {
  /** Provider conversation id. */
  id: string;
  /** Display title from the sidebar. */
  title: string;
  /** Canonical conversation URL. */
  url: string;
}
