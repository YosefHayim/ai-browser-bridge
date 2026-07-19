import type { FanoutBatchOptions, FanoutBatchResult, FanoutTask } from "@/features/bridge";
import { parseProviderList } from "@/features/providers";
import { effectSchemaToMcpShape } from "@/features/tools";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Page } from "playwright";
import {
  type AskToolArgs,
  AskToolArgsSchema,
  type SearchConversationsArgs,
  SearchConversationsArgsSchema,
} from "./agentGatewaySchemas.ts";
import { registerChatgptGatewayTools } from "./chatgptGatewayTools.ts";
import { registerFlowGatewayTools } from "./flowGatewayTools.ts";

/**
 * The outbound MCP surface: a local agent connects to this server and calls `ask` to
 * drive one or more web chats — one prompt fanned across providers, or a `tasks` array of
 * independent Conversations run in parallel. This is the OPPOSITE direction to the inbound
 * MCP server in `tools/` (which exposes repo tools TO the web model). Both go over the same
 * fan-out core, injected here as `runBatch`.
 */
export interface AskGatewayDeps {
  /** Run a batch of fan-out tasks (one tab each) and return the ordered, paginated result. */
  runBatch: (tasks: FanoutTask[], opts: FanoutBatchOptions) => Promise<FanoutBatchResult>;
  /** Search conversation history across the resolved providers. */
  searchConversations?: (
    providers: string[],
    query: string,
    opts: { limit?: number },
  ) => Promise<Record<string, unknown>>;
  /**
   * Run one operation against a Flow project page, owning the browser/engine lifecycle
   * (attach to the warm browser, hand over the page, shut down keeping it warm). Absent
   * when the gateway has no Flow session, in which case the `flow_*` tools report cleanly.
   */
  withFlowPage?: <T>(op: (page: Page) => Promise<T>) => Promise<T>;
  /**
   * Run one operation against the active ChatGPT page, owning the browser/engine lifecycle
   * the same way as {@link AskGatewayDeps.withFlowPage}. Absent when the gateway has no
   * ChatGPT session, in which case the `chatgpt_*` tools report cleanly.
   */
  withChatGptPage?: <T>(op: (page: Page) => Promise<T>) => Promise<T>;
}

/** Arguments accepted by {@link handleAskGatewayCall}. */
export type AskGatewayArgs = AskToolArgs;

/**
 * Resolve `ask` args to an ordered task list: an explicit `tasks` array when given, else one
 * task per provider from `prompt`/`providers`. Throws on an unknown provider or a missing
 * prompt so {@link handleAskGatewayCall} can report it cleanly.
 */
const resolveGatewayTasks = (args: AskGatewayArgs): FanoutTask[] => {
  if (args.tasks && args.tasks.length > 0) return [...args.tasks];
  if (!args.prompt) {
    throw new Error("Provide `prompt` (with optional `providers`) or a non-empty `tasks` array.");
  }
  const prompt = args.prompt;
  return parseProviderList(args.providers).map((provider) => ({ prompt, provider }));
};

/** Map `ask` args to fan-out batch options, dropping the ones the caller left unset. */
const gatewayBatchOptions = (args: AskGatewayArgs): FanoutBatchOptions => {
  return {
    ...(args.timeoutSeconds ? { timeoutMs: args.timeoutSeconds * 1000 } : {}),
    ...(args.maxConcurrency ? { maxConcurrency: args.maxConcurrency } : {}),
    ...(args.limit ? { limit: args.limit } : {}),
    ...(args.offset !== undefined ? { offset: args.offset } : {}),
    ...(args.maxReplyChars ? { maxReplyChars: args.maxReplyChars } : {}),
  };
};

/** Arguments accepted by {@link handleConversationSearchGatewayCall}. */
export type ConversationSearchGatewayArgs = SearchConversationsArgs;

/**
 * Handle one `ask` call: resolve the task list (fail-loud on unknown provider or missing
 * prompt), run it through the fan-out batch core, and return the ordered result as JSON.
 * Never throws — a bad argument becomes `{ ok: false }` so the tool reports it cleanly.
 *
 * @param deps - Dependencies supplied by the caller.
 * @param args - The decoded `ask` tool arguments.
 * @returns An `{ ok, output }` pair whose `output` is the JSON fan-out result or an error message.
 * @example
 * ```ts
 * const result = await handleAskGatewayCall(deps, { prompt: "hi", providers: "chatgpt,gemini" });
 * ```
 */
export const handleAskGatewayCall = async (
  deps: AskGatewayDeps,
  args: AskGatewayArgs,
): Promise<{ ok: boolean; output: string }> => {
  let tasks: FanoutTask[];
  try {
    tasks = resolveGatewayTasks(args);
  } catch (err) {
    return { ok: false, output: err instanceof Error ? err.message : String(err) };
  }
  const result = await deps.runBatch(tasks, gatewayBatchOptions(args));
  return { ok: true, output: JSON.stringify(result) };
};

/**
 * Handle one outbound MCP `search_conversations` call.
 *
 * @param deps - Dependencies supplied by the caller.
 * @param args - Args value.
 * @returns The `handleConversationSearchGatewayCall` result.
 * @example
 * ```ts
 * const result = await handleConversationSearchGatewayCall(deps, args);
 * ```
 */
export const handleConversationSearchGatewayCall = async (
  deps: AskGatewayDeps,
  args: ConversationSearchGatewayArgs,
): Promise<{ ok: boolean; output: string }> => {
  if (!deps.searchConversations) {
    return { ok: false, output: "Conversation search is not available in this gateway." };
  }
  let providers: string[];
  try {
    providers = parseProviderList(args.providers);
  } catch (err) {
    return { ok: false, output: err instanceof Error ? err.message : String(err) };
  }
  const result = await deps.searchConversations(providers, args.query, { limit: args.limit });
  return { ok: true, output: JSON.stringify(result) };
};

/**
 * Build an MCP server exposing a single `ask` tool over the fan-out core. Served over
 * stdio by {@link serveAskGatewayStdio}; the browser-backed `runFanout` is injected at
 * the composition root — `bridge serve` (`runServe` in the terminal feature).
 *
 * @param deps - Dependencies supplied by the caller.
 * @returns The `createAskGatewayServer` result.
 * @example
 * ```ts
 * const result = createAskGatewayServer(deps);
 * ```
 */
export const createAskGatewayServer = (deps: AskGatewayDeps): McpServer => {
  const mcp = new McpServer({ name: "ai-browser-bridge-ask", version: "0.1.0" });
  mcp.tool(
    "ask",
    "Drive web chats: one prompt fanned across providers, or a `tasks` array of independent Conversations run in parallel (new or resumed). Returns an ordered, paginated result — one row per task with its reply and reopenable Conversation id/url.",
    effectSchemaToMcpShape(AskToolArgsSchema),
    {},
    async (args: Record<string, unknown>) => {
      const result = await handleAskGatewayCall(deps, args as unknown as AskGatewayArgs);
      return { content: [{ type: "text" as const, text: result.output }], isError: !result.ok };
    },
  );
  mcp.tool(
    "search_conversations",
    "Search provider conversation history by title/id and return matching conversation URLs.",
    effectSchemaToMcpShape(SearchConversationsArgsSchema),
    {},
    async (args: Record<string, unknown>) => {
      const result = await handleConversationSearchGatewayCall(
        deps,
        args as unknown as ConversationSearchGatewayArgs,
      );
      return { content: [{ type: "text" as const, text: result.output }], isError: !result.ok };
    },
  );
  registerFlowGatewayTools(mcp, deps);
  registerChatgptGatewayTools(mcp, deps);
  return mcp;
};
