/** Chat message captured from the browser conversation. */
export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Unix timestamp in milliseconds. */
  timestamp: number;
  toolCalls?: ToolCall[];
};

/** Assistant-issued tool invocation. */
export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

/** Result returned from an MCP tool handler. */
export type ToolResult = {
  ok: boolean;
  output: string;
  error?: string;
};

/** Sidebar conversation entry from the provider UI. */
export type Conversation = {
  id: string;
  title: string;
  url: string;
};
