import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Page } from "playwright";
import { readAllChatGptTabRenderStates, readChatGptRenderState } from "@/features/providers";
import { effectSchemaToMcpShape } from "@/features/tools";
import { type AskToolResult, ChatgptRenderStateArgsSchema } from "./agentGatewaySchemas.ts";
import {
  type AskGatewayDeps,
  gatewayErrorMessage,
  gatewayJsonOutput,
  mcpTextFromGatewayReply,
} from "./askGatewayServer.ts";

/** Outbound MCP tool names for ChatGPT render-state recon (agent-facing `bridge chatgpt …`). */
export type ChatgptGatewayTool = "chatgpt_render_state";

/** Run one ChatGPT page op through `withChatGptPage` and wrap as `{ ok, output }`. */
const runOnChatGptPage = async <T>(
  deps: AskGatewayDeps,
  op: (page: Page) => Promise<T>,
): Promise<AskToolResult> => {
  if (deps.withChatGptPage === undefined) {
    return {
      ok: false,
      output:
        "ChatGPT tools are not available in this gateway (no browser-backed ChatGPT session).",
    };
  }
  try {
    const pageValue = await deps.withChatGptPage(op);
    return { ok: true, output: gatewayJsonOutput(pageValue) };
  } catch (error) {
    return { ok: false, output: gatewayErrorMessage(error) };
  }
};

/**
 * Dispatch one `chatgpt_*` outbound MCP call. Never throws — failures return `{ ok: false }`.
 */
export const handleChatgptGatewayCall = async (
  deps: AskGatewayDeps,
  tool: ChatgptGatewayTool,
  args: Record<string, unknown>,
): Promise<AskToolResult> => {
  switch (tool) {
    case "chatgpt_render_state": {
      if (args.allTabs === true) {
        return runOnChatGptPage(deps, (page) => readAllChatGptTabRenderStates(page));
      }
      return runOnChatGptPage(deps, (page) => readChatGptRenderState(page));
    }
  }
};

/** Register `chatgpt_*` recon tools on an outbound MCP server. */
export const registerChatgptGatewayTools = (mcp: McpServer, deps: AskGatewayDeps): void => {
  mcp.registerTool(
    "chatgpt_render_state",
    {
      description:
        "Inspect the current ChatGPT render: streaming?, generated-image progress (loaded/pending), misfire and rate/cap-limit signals, and the latest assistant text. Pass allTabs:true to sweep every ChatGPT tab in the browser.",
      inputSchema: effectSchemaToMcpShape(ChatgptRenderStateArgsSchema),
    },
    async (args: Record<string, unknown>) =>
      mcpTextFromGatewayReply(await handleChatgptGatewayCall(deps, "chatgpt_render_state", args)),
  );
};
