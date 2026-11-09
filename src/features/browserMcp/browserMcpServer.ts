import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Page } from "playwright";
import type { BridgeProviderId } from "@/config.ts";
import type { FanoutTask } from "@/features/bridge/engine/bridgeSchemas.ts";
import type { FanoutOptions, FanoutResult } from "@/features/bridge/fanout/runConversationTasks.ts";
import { providerIdsFrom } from "@/features/webProviders/providerRegistry.ts";
import { effectSchemaToMcpShape } from "@/mcpSchema.ts";
import {
  type AskToolArgs,
  AskToolArgsSchema,
  type AskToolResult,
  type SearchConversationsArgs,
  SearchConversationsArgsSchema,
} from "./browserMcpSchemas.ts";
import { registerChatgptMcpTools } from "./tools/chatgptMcpTools.ts";
import { registerDesignMcpTools } from "./tools/designMcpTools.ts";
import { registerFlowMcpTools } from "./tools/flowMcpTools.ts";

export type BrowserMcpOperations = {
  readonly repoRoot: string;
  readonly fanOut: (tasks: FanoutTask[], options: FanoutOptions) => Promise<FanoutResult>;
  readonly searchConversations?: (
    providers: BridgeProviderId[],
    query: string,
    options: { limit?: number },
  ) => Promise<Record<string, unknown>>;
  // Absent without a Flow session — flow_* tools report that cleanly.
  readonly withFlowPage?: <T>(runPage: (page: Page) => Promise<T>) => Promise<T>;
  // Absent without a ChatGPT session — chatgpt_* tools report that cleanly.
  readonly withChatGptPage?: <T>(runPage: (page: Page) => Promise<T>) => Promise<T>;
  // Absent without a Claude Design session — design_* tools report that cleanly.
  readonly withDesignPage?: <T>(runPage: (page: Page) => Promise<T>) => Promise<T>;
};

export const mcpErrorMessage = (thrown: unknown): string => {
  if (thrown instanceof Error) return thrown.message;
  return String(thrown);
};

// JSON.stringify(undefined) is undefined; MCP text content needs a real string.
export const mcpJsonOutput = (toolValue: unknown): string => {
  const encoded = JSON.stringify(toolValue);
  if (encoded === undefined) return "null";
  return encoded;
};

export const mcpTextReply = (mcpReply: AskToolResult) => ({
  content: [{ type: "text" as const, text: mcpReply.output }],
  isError: !mcpReply.ok,
});

const fanoutTasksFromArgs = (askToolRequest: AskToolArgs): FanoutTask[] => {
  if (askToolRequest.tasks !== undefined && askToolRequest.tasks.length > 0)
    return [...askToolRequest.tasks];
  if (askToolRequest.prompt === undefined) {
    throw new Error("Provide `prompt` (with optional `providers`) or a non-empty `tasks` array.");
  }
  const prompt = askToolRequest.prompt;
  return providerIdsFrom(askToolRequest.providers).map((provider) => ({ prompt, provider }));
};

const fanoutOptionsFromArgs = (askToolRequest: AskToolArgs): FanoutOptions => {
  const fanoutOptions: FanoutOptions = {};
  if (askToolRequest.timeoutSeconds !== undefined) {
    fanoutOptions.timeoutMs = askToolRequest.timeoutSeconds * 1000;
  }
  if (askToolRequest.maxConcurrency !== undefined) {
    fanoutOptions.maxConcurrency = askToolRequest.maxConcurrency;
  }
  if (askToolRequest.limit !== undefined) {
    fanoutOptions.limit = askToolRequest.limit;
  }
  if (askToolRequest.offset !== undefined) {
    fanoutOptions.offset = askToolRequest.offset;
  }
  if (askToolRequest.maxReplyChars !== undefined) {
    fanoutOptions.maxReplyChars = askToolRequest.maxReplyChars;
  }
  return fanoutOptions;
};

// Never throws — bad arguments become `{ ok: false }` for the MCP wire reply.
export const handleAskMcpCall = async (
  deps: BrowserMcpOperations,
  askToolRequest: AskToolArgs,
): Promise<AskToolResult> => {
  let tasks: FanoutTask[];
  try {
    tasks = fanoutTasksFromArgs(askToolRequest);
  } catch (thrown) {
    return { ok: false, output: mcpErrorMessage(thrown) };
  }
  const fanoutResult = await deps.fanOut(tasks, fanoutOptionsFromArgs(askToolRequest));
  return { ok: true, output: mcpJsonOutput(fanoutResult) };
};

// Never throws — missing search dep or bad providers become `{ ok: false }`.
export const handleConversationSearchMcpCall = async (
  deps: BrowserMcpOperations,
  searchConversationsRequest: SearchConversationsArgs,
): Promise<AskToolResult> => {
  if (deps.searchConversations === undefined) {
    return { ok: false, output: "Conversation search is not available in this gateway." };
  }
  let providers: BridgeProviderId[];
  try {
    providers = providerIdsFrom(searchConversationsRequest.providers);
  } catch (thrown) {
    return { ok: false, output: mcpErrorMessage(thrown) };
  }
  const searchResult = await deps.searchConversations(providers, searchConversationsRequest.query, {
    limit: searchConversationsRequest.limit,
  });
  return { ok: true, output: mcpJsonOutput(searchResult) };
};

export const createBrowserMcpServer = (deps: BrowserMcpOperations): McpServer => {
  const mcpServer = new McpServer({ name: "ai-browser-bridge-ask", version: "0.1.0" });
  mcpServer.registerTool(
    "ask",
    {
      description:
        "Drive web chats: one prompt fanned across providers, or a `tasks` array of independent Conversations run in parallel (new or resumed). Returns an ordered, paginated result — one row per task with its reply and reopenable Conversation id/url.",
      inputSchema: effectSchemaToMcpShape(AskToolArgsSchema),
    },
    async (toolRequest: Record<string, unknown>) => {
      // MCP SDK already validated against AskToolArgsSchema at the wire edge.
      const mcpReply = await handleAskMcpCall(deps, toolRequest as AskToolArgs);
      return mcpTextReply(mcpReply);
    },
  );
  mcpServer.registerTool(
    "search_conversations",
    {
      description:
        "Search provider conversation history by title/id and return matching conversation URLs.",
      inputSchema: effectSchemaToMcpShape(SearchConversationsArgsSchema),
    },
    async (toolRequest: Record<string, unknown>) => {
      // MCP SDK already validated against SearchConversationsArgsSchema at the wire edge.
      const mcpReply = await handleConversationSearchMcpCall(
        deps,
        toolRequest as SearchConversationsArgs,
      );
      return mcpTextReply(mcpReply);
    },
  );
  registerFlowMcpTools(mcpServer, deps);
  registerChatgptMcpTools(mcpServer, deps);
  registerDesignMcpTools(mcpServer, deps);
  return mcpServer;
};

export const serveBrowserMcp = async (operations: BrowserMcpOperations): Promise<void> => {
  const server = createBrowserMcpServer(operations);
  await server.connect(new StdioServerTransport());
};
