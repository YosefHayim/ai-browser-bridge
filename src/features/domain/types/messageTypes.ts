export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  // Unix timestamp in milliseconds.
  timestamp: number;
  toolCalls?: ToolCall[];
};

export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type ToolResult = {
  ok: boolean;
  output: string;
  error?: string;
};

export type Conversation = {
  id: string;
  title: string;
  url: string;
};
