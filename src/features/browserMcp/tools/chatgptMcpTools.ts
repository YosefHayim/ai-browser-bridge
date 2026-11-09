import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Page } from "playwright";
import {
  readAllChatGptTabRenderStates,
  readChatGptRenderState,
} from "@/features/webProviders/chatgpt/content/chatgptRenderState.ts";
import { effectSchemaToMcpShape } from "@/mcpSchema.ts";
import { type AskToolResult, ChatgptRenderStateArgsSchema } from "../browserMcpSchemas.ts";
import {
  type BrowserMcpOperations,
  mcpErrorMessage,
  mcpJsonOutput,
  mcpTextReply,
} from "../browserMcpServer.ts";

export type ChatgptMcpTool = "chatgpt_render_state";

const runOnChatGptPage = async <T>(
  deps: BrowserMcpOperations,
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
    return { ok: true, output: mcpJsonOutput(pageOutcome) };
  } catch (error) {
    return { ok: false, output: mcpErrorMessage(error) };
  }
};

// Never throws — missing session and page failures surface as `{ ok: false }`.
export const handleChatgptMcpCall = async (
  deps: BrowserMcpOperations,
  tool: ChatgptMcpTool,
  chatgptToolRequest: Record<string, unknown>,
): Promise<AskToolResult> => {
  switch (tool) {
    case "chatgpt_render_state": {
      if (chatgptToolRequest.allTabs === true) {
        return runOnChatGptPage(deps, (page) => readAllChatGptTabRenderStates(page));
      }
      return runOnChatGptPage(deps, (page) => readChatGptRenderState(page));
    }
  }
};

export const registerChatgptMcpTools = (mcp: McpServer, deps: BrowserMcpOperations): void => {
  mcp.registerTool(
    "chatgpt_render_state",
    {
      description:
        "Inspect the current ChatGPT render: streaming?, generated-image progress (loaded/pending), misfire and rate/cap-limit signals, and the latest assistant text. Pass allTabs:true to sweep every ChatGPT tab in the browser.",
      inputSchema: effectSchemaToMcpShape(ChatgptRenderStateArgsSchema),
    },
    async (chatgptToolRequest: Record<string, unknown>) =>
      mcpTextReply(await handleChatgptMcpCall(deps, "chatgpt_render_state", chatgptToolRequest)),
  );
};
