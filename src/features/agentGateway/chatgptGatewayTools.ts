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

export type ChatgptGatewayTool = "chatgpt_render_state";

const runOnChatGptPage = async <T>(
  deps: AskGatewayDeps,
  pageOperation: (page: Page) => Promise<T>,
): Promise<AskToolResult> => {
  if (deps.withChatGptPage === undefined) {
    return {
      ok: false,
      output:
        "ChatGPT tools are not available in this gateway (no browser-backed ChatGPT session).",
    };
  }
  try {
    const pageOutcome = await deps.withChatGptPage(pageOperation);
    return { ok: true, output: gatewayJsonOutput(pageOutcome) };
  } catch (error) {
    return { ok: false, output: gatewayErrorMessage(error) };
  }
};

// Never throws — missing session and page failures surface as `{ ok: false }`.
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
