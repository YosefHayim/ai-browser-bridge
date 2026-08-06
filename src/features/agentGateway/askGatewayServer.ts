import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Page } from "playwright";
import type { FanoutOptions, FanoutResult, FanoutTask } from "@/features/bridge";
import { providerIdsFrom } from "@/features/providers";
import { effectSchemaToMcpShape } from "@/features/tools";
import {
  type AskToolArgs,
  AskToolArgsSchema,
  type AskToolResult,
  type SearchConversationsArgs,
  SearchConversationsArgsSchema,
} from "./agentGatewaySchemas.ts";
import { registerChatgptGatewayTools } from "./chatgptGatewayTools.ts";
import { registerFlowGatewayTools } from "./flowGatewayTools.ts";

export type AskGatewayDeps = {
  readonly repoRoot: string;
  readonly fanOut: (tasks: FanoutTask[], options: FanoutOptions) => Promise<FanoutResult>;
  readonly searchConversations?: (
    providers: string[],
    query: string,
    options: { limit?: number },
  ) => Promise<Record<string, unknown>>;
  // Absent without a Flow session — flow_* tools report that cleanly.
  readonly withFlowPage?: <T>(runPage: (page: Page) => Promise<T>) => Promise<T>;
  // Absent without a ChatGPT session — chatgpt_* tools report that cleanly.
  readonly withChatGptPage?: <T>(runPage: (page: Page) => Promise<T>) => Promise<T>;
};

export const gatewayErrorMessage = (thrown: unknown): string => {
  if (thrown instanceof Error) return thrown.message;
  return String(thrown);
};

// JSON.stringify(undefined) is undefined; MCP text content needs a real string.
export const gatewayJsonOutput = (toolValue: unknown): string => {
  const encoded = JSON.stringify(toolValue);
  if (encoded === undefined) return "null";
  return encoded;
};

export const mcpTextFromGatewayReply = (gatewayReply: AskToolResult) => ({
  content: [{ type: "text" as const, text: gatewayReply.output }],
  isError: !gatewayReply.ok,
});

const gatewayTasksFrom = (args: AskToolArgs): FanoutTask[] => {
  if (args.tasks !== undefined && args.tasks.length > 0) return [...args.tasks];
  if (args.prompt === undefined) {
    throw new Error("Provide `prompt` (with optional `providers`) or a non-empty `tasks` array.");
  }
  const prompt = args.prompt;
  return providerIdsFrom(args.providers).map((provider) => ({ prompt, provider }));
};

const gatewayFanoutOptions = (args: AskToolArgs): FanoutOptions => {
  const fanoutOptions: FanoutOptions = {};
  if (args.timeoutSeconds !== undefined) {
    fanoutOptions.timeoutMs = args.timeoutSeconds * 1000;
  }
  if (args.maxConcurrency !== undefined) {
    fanoutOptions.maxConcurrency = args.maxConcurrency;
  }
  if (args.limit !== undefined) {
    fanoutOptions.limit = args.limit;
  }
  if (args.offset !== undefined) {
    fanoutOptions.offset = args.offset;
  }
  if (args.maxReplyChars !== undefined) {
    fanoutOptions.maxReplyChars = args.maxReplyChars;
  }
  return fanoutOptions;
};

// Never throws — bad arguments become `{ ok: false }` for the MCP wire reply.
export const handleAskGatewayCall = async (
  deps: AskGatewayDeps,
  args: AskToolArgs,
): Promise<AskToolResult> => {
  let tasks: FanoutTask[];
  try {
    tasks = gatewayTasksFrom(args);
  } catch (thrown) {
    return { ok: false, output: gatewayErrorMessage(thrown) };
  }
  const fanoutResult = await deps.fanOut(tasks, gatewayFanoutOptions(args));
  return { ok: true, output: gatewayJsonOutput(fanoutResult) };
};

// Never throws — missing search dep or bad providers become `{ ok: false }`.
export const handleConversationSearchGatewayCall = async (
  deps: AskGatewayDeps,
  args: SearchConversationsArgs,
): Promise<AskToolResult> => {
  if (deps.searchConversations === undefined) {
    return { ok: false, output: "Conversation search is not available in this gateway." };
  }
  let providers: string[];
  try {
    providers = providerIdsFrom(args.providers);
  } catch (thrown) {
    return { ok: false, output: gatewayErrorMessage(thrown) };
  }
  const searchResult = await deps.searchConversations(providers, args.query, {
    limit: args.limit,
  });
  return { ok: true, output: gatewayJsonOutput(searchResult) };
};

export const askGatewayServerFor = (deps: AskGatewayDeps): McpServer => {
  const mcpServer = new McpServer({ name: "ai-browser-bridge-ask", version: "0.1.0" });
  mcpServer.registerTool(
    "ask",
    {
      description:
        "Drive web chats: one prompt fanned across providers, or a `tasks` array of independent Conversations run in parallel (new or resumed). Returns an ordered, paginated result — one row per task with its reply and reopenable Conversation id/url.",
      inputSchema: effectSchemaToMcpShape(AskToolArgsSchema),
    },
    async (args: Record<string, unknown>) => {
      // MCP SDK already validated against AskToolArgsSchema at the wire edge.
      const gatewayReply = await handleAskGatewayCall(deps, args as AskToolArgs);
      return mcpTextFromGatewayReply(gatewayReply);
    },
  );
  mcpServer.registerTool(
    "search_conversations",
    {
      description:
        "Search provider conversation history by title/id and return matching conversation URLs.",
      inputSchema: effectSchemaToMcpShape(SearchConversationsArgsSchema),
    },
    async (args: Record<string, unknown>) => {
      // MCP SDK already validated against SearchConversationsArgsSchema at the wire edge.
      const gatewayReply = await handleConversationSearchGatewayCall(
        deps,
        args as SearchConversationsArgs,
      );
      return mcpTextFromGatewayReply(gatewayReply);
    },
  );
  registerFlowGatewayTools(mcpServer, deps);
  registerChatgptGatewayTools(mcpServer, deps);
  return mcpServer;
};
