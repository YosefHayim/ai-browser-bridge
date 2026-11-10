import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Page } from "playwright";
import type { FanoutTask } from "@/bridge/bridge-schemas.ts";
import type { FanoutOptions, FanoutResult } from "@/bridge/fanout-pool.ts";
import { providerIdsFrom } from "@/providers/providers.ts";
import {
  type AskToolArgs,
  AskToolArgsSchema,
  type AskToolResult,
  type SearchConversationsArgs,
  SearchConversationsArgsSchema,
} from "./agent-gateway-schemas.ts";
import { registerChatgptGatewayTools } from "./chatgpt-gateway-tools.ts";
import { registerDesignGatewayTools } from "./design-gateway-tools.ts";
import { registerFlowGatewayTools } from "./flow-gateway-tools.ts";

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
  // Absent without a Claude Design session — design_* tools report that cleanly.
  readonly withDesignPage?: <T>(runPage: (page: Page) => Promise<T>) => Promise<T>;
};

export const gatewayErrorMessage = (thrown: unknown): string => {
  const isThrownInstanceError = thrown instanceof Error;
  if (isThrownInstanceError) return thrown.message;

  return String(thrown);
};

// JSON.stringify(undefined) is undefined; MCP text content needs a real string.
export const gatewayJsonOutput = (toolValue: unknown): string => {
  const encoded = JSON.stringify(toolValue);

  const isEncodedMissing = encoded === undefined;
  if (isEncodedMissing) return "null";

  return encoded;
};

export const mcpTextFromGatewayReply = (gatewayReply: AskToolResult) => ({
  content: [{ type: "text" as const, text: gatewayReply.output }],
  isError: !gatewayReply.ok,
});

const gatewayTasksFrom = (args: AskToolArgs): FanoutTask[] => {
  const hasTasks = args.tasks !== undefined && args.tasks.length > 0;
  if (hasTasks) return [...args.tasks];

  const isPromptMissing = args.prompt === undefined;
  if (isPromptMissing) {
    throw new Error("Provide `prompt` (with optional `providers`) or a non-empty `tasks` array.");
  }

  const prompt = args.prompt;
  return providerIdsFrom(args.providers).map((provider) => ({ prompt, provider }));
};

const gatewayFanoutOptions = (args: AskToolArgs): FanoutOptions => {
  const fanoutOptions: FanoutOptions = {};

  const hasTimeoutSeconds = args.timeoutSeconds !== undefined;
  if (hasTimeoutSeconds) {
    fanoutOptions.timeoutMs = args.timeoutSeconds * 1000;
  }

  const hasMaxConcurrency = args.maxConcurrency !== undefined;
  if (hasMaxConcurrency) {
    fanoutOptions.maxConcurrency = args.maxConcurrency;
  }

  const hasLimit = args.limit !== undefined;
  if (hasLimit) {
    fanoutOptions.limit = args.limit;
  }

  const hasOffset = args.offset !== undefined;
  if (hasOffset) {
    fanoutOptions.offset = args.offset;
  }

  const hasMaxReplyChars = args.maxReplyChars !== undefined;
  if (hasMaxReplyChars) {
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
  const isSearchConversationsMissing = deps.searchConversations === undefined;
  if (isSearchConversationsMissing) {
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
      inputSchema: AskToolArgsSchema.shape,
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
      inputSchema: SearchConversationsArgsSchema.shape,
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
  registerDesignGatewayTools(mcpServer, deps);
  return mcpServer;
};
