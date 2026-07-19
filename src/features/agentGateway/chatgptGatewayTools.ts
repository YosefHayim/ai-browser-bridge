import { readAllChatGptTabRenderStates, readChatGptRenderState } from "@/features/providers";
import { effectSchemaToMcpShape } from "@/features/tools";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Page } from "playwright";
import { ChatgptRenderStateArgsSchema } from "./agentGatewaySchemas.ts";
import type { AskGatewayDeps } from "./askGatewayServer.ts";

/**
 * The outbound MCP tool names for ChatGPT render-state recon — the agent-facing counterpart to
 * the `bridge chatgpt …` CLI, so a pure-MCP client (no shell) can inspect "what is the render
 * doing now" without hand-writing a Playwright probe.
 */
export type ChatgptGatewayTool = "chatgpt_render_state";

/**
 * Run one ChatGPT page op through the injected `withChatGptPage` seam and wrap the result as a
 * gateway `{ ok, output }`. The seam (supplied at the composition root) owns the engine
 * lifecycle — attach to the warm browser, hand over the page, shut down keeping the browser
 * warm — so this feature stays browser-agnostic and unit-testable.
 */
const runChatgptPageOp = async <T>(
  deps: AskGatewayDeps,
  op: (page: Page) => Promise<T>,
): Promise<{ ok: boolean; output: string }> => {
  if (!deps.withChatGptPage) {
    return {
      ok: false,
      output:
        "ChatGPT tools are not available in this gateway (no browser-backed ChatGPT session).",
    };
  }
  try {
    const result = await deps.withChatGptPage(op);
    const output = JSON.stringify(result);
    return { ok: true, output: output ?? "null" };
  } catch (err) {
    return { ok: false, output: err instanceof Error ? err.message : String(err) };
  }
};

/**
 * Dispatch one `chatgpt_*` outbound MCP call to its recon verb. Never throws — any failure
 * (missing session, DOM change) is returned as `{ ok: false }` so the tool reports it cleanly.
 *
 * @param deps - Gateway dependencies (supplies the `withChatGptPage` browser seam).
 * @param tool - The `chatgpt_*` tool being invoked.
 * @param args - The SDK-validated tool arguments.
 * @returns The keyed `{ ok, output }` result; `output` is JSON on success.
 * @example
 * ```ts
 * const res = await handleChatgptGatewayCall(deps, "chatgpt_render_state", { allTabs: true });
 * ```
 */
export const handleChatgptGatewayCall = async (
  deps: AskGatewayDeps,
  tool: ChatgptGatewayTool,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; output: string }> => {
  switch (tool) {
    case "chatgpt_render_state":
      return args.allTabs === true
        ? runChatgptPageOp(deps, (page) => readAllChatGptTabRenderStates(page))
        : runChatgptPageOp(deps, (page) => readChatGptRenderState(page));
  }
};

/**
 * Register the `chatgpt_*` recon tools on an outbound MCP server, each delegating to
 * {@link handleChatgptGatewayCall}. Called from `createAskGatewayServer` so the recon is
 * available to pure-MCP agents alongside `ask` / `search_conversations` / `flow_*`.
 *
 * @param mcp - The outbound MCP server to register tools on.
 * @param deps - Gateway dependencies threaded into each handler.
 * @returns Nothing; tools are registered as a side effect.
 * @example
 * ```ts
 * registerChatgptGatewayTools(mcp, deps);
 * ```
 */
export const registerChatgptGatewayTools = (mcp: McpServer, deps: AskGatewayDeps): void => {
  const respond = (result: { ok: boolean; output: string }) => ({
    content: [{ type: "text" as const, text: result.output }],
    isError: !result.ok,
  });
  mcp.tool(
    "chatgpt_render_state",
    "Inspect the current ChatGPT render: streaming?, generated-image progress (loaded/pending), misfire and rate/cap-limit signals, and the latest assistant text. Pass allTabs:true to sweep every ChatGPT tab in the browser.",
    effectSchemaToMcpShape(ChatgptRenderStateArgsSchema),
    {},
    async (args: Record<string, unknown>) =>
      respond(await handleChatgptGatewayCall(deps, "chatgpt_render_state", args)),
  );
};
