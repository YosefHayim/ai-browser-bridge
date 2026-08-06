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

/**
 * Outbound MCP surface: a local agent calls `ask` to drive web chats (one prompt
 * fanned across providers, or a `tasks` array of independent Conversations). Opposite
 * of the inbound MCP server in `tools/`. Browser work is injected via `fanOut`.
 */
export type AskGatewayDeps = {
  /** Canonical target-repository root used for generated output paths. */
  readonly repoRoot: string;
  /** Run an ordered fan-out (one tab each) and return the ordered, paginated result. */
  readonly fanOut: (tasks: FanoutTask[], opts: FanoutOptions) => Promise<FanoutResult>;
  /** Search conversation history across the resolved providers. */
  readonly searchConversations?: (
    providers: string[],
    query: string,
    opts: { limit?: number },
  ) => Promise<Record<string, unknown>>;
  /**
   * Run one operation against a Flow project page, owning browser/engine lifecycle.
   * Absent when the gateway has no Flow session — `flow_*` tools then report cleanly.
   */
  readonly withFlowPage?: <T>(op: (page: Page) => Promise<T>) => Promise<T>;
  /**
   * Run one operation against the active ChatGPT page, same lifecycle ownership as
   * {@link AskGatewayDeps.withFlowPage}. Absent without a ChatGPT session.
   */
  readonly withChatGptPage?: <T>(op: (page: Page) => Promise<T>) => Promise<T>;
};

/** Format an unknown thrown value as a message string for tool replies. */
export const gatewayErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return String(error);
};

/** JSON-encode a tool value; `undefined` becomes the string `"null"` for MCP text content. */
export const gatewayJsonOutput = (value: unknown): string => {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) return "null";
  return encoded;
};

/** MCP SDK text content from a gateway `{ ok, output }` reply. */
export const mcpTextFromGatewayReply = (reply: AskToolResult) => ({
  content: [{ type: "text" as const, text: reply.output }],
  isError: !reply.ok,
});

/** Resolve `ask` args to an ordered task list; throws on unknown provider or missing prompt. */
const gatewayTasksFrom = (args: AskToolArgs): FanoutTask[] => {
  if (args.tasks !== undefined && args.tasks.length > 0) return [...args.tasks];
  if (args.prompt === undefined) {
    throw new Error("Provide `prompt` (with optional `providers`) or a non-empty `tasks` array.");
  }
  const prompt = args.prompt;
  return providerIdsFrom(args.providers).map((provider) => ({ prompt, provider }));
};

/** Map `ask` args to fan-out options, omitting fields the caller left unset. */
const gatewayFanoutOptions = (args: AskToolArgs): FanoutOptions => {
  const options: FanoutOptions = {};
  if (args.timeoutSeconds !== undefined) {
    options.timeoutMs = args.timeoutSeconds * 1000;
  }
  if (args.maxConcurrency !== undefined) {
    options.maxConcurrency = args.maxConcurrency;
  }
  if (args.limit !== undefined) {
    options.limit = args.limit;
  }
  if (args.offset !== undefined) {
    options.offset = args.offset;
  }
  if (args.maxReplyChars !== undefined) {
    options.maxReplyChars = args.maxReplyChars;
  }
  return options;
};

/**
 * Handle one `ask` call: resolve tasks, run fan-out, return ordered JSON.
 * Never throws — bad arguments become `{ ok: false }`.
 */
export const handleAskGatewayCall = async (
  deps: AskGatewayDeps,
  args: AskToolArgs,
): Promise<AskToolResult> => {
  let tasks: FanoutTask[];
  try {
    tasks = gatewayTasksFrom(args);
  } catch (error) {
    return { ok: false, output: gatewayErrorMessage(error) };
  }
  const fanoutResult = await deps.fanOut(tasks, gatewayFanoutOptions(args));
  return { ok: true, output: gatewayJsonOutput(fanoutResult) };
};

/** Handle one outbound MCP `search_conversations` call. Never throws. */
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
  } catch (error) {
    return { ok: false, output: gatewayErrorMessage(error) };
  }
  const searchResult = await deps.searchConversations(providers, args.query, {
    limit: args.limit,
  });
  return { ok: true, output: gatewayJsonOutput(searchResult) };
};

/**
 * Build an MCP server exposing `ask`, `search_conversations`, plus Flow/ChatGPT tools.
 * Served over stdio by {@link serveAskGatewayStdio}; browser-backed `fanOut` is injected
 * at the composition root (`bridge serve`).
 */
export const createAskGatewayServer = (deps: AskGatewayDeps): McpServer => {
  const mcp = new McpServer({ name: "ai-browser-bridge-ask", version: "0.1.0" });
  mcp.registerTool(
    "ask",
    {
      description:
        "Drive web chats: one prompt fanned across providers, or a `tasks` array of independent Conversations run in parallel (new or resumed). Returns an ordered, paginated result — one row per task with its reply and reopenable Conversation id/url.",
      inputSchema: effectSchemaToMcpShape(AskToolArgsSchema),
    },
    async (args: Record<string, unknown>) => {
      // MCP SDK already validated against AskToolArgsSchema at the wire edge.
      const reply = await handleAskGatewayCall(deps, args as AskToolArgs);
      return mcpTextFromGatewayReply(reply);
    },
  );
  mcp.registerTool(
    "search_conversations",
    {
      description:
        "Search provider conversation history by title/id and return matching conversation URLs.",
      inputSchema: effectSchemaToMcpShape(SearchConversationsArgsSchema),
    },
    async (args: Record<string, unknown>) => {
      // MCP SDK already validated against SearchConversationsArgsSchema at the wire edge.
      const reply = await handleConversationSearchGatewayCall(
        deps,
        args as SearchConversationsArgs,
      );
      return mcpTextFromGatewayReply(reply);
    },
  );
  registerFlowGatewayTools(mcp, deps);
  registerChatgptGatewayTools(mcp, deps);
  return mcp;
};
