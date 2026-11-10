import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Page } from "playwright";
import {
  readAllChatGptTabRenderStatuses,
  readChatGptRenderStatus,
} from "@/providers/chatgpt/chatgpt-render-state.ts";
import { type AskToolResult, ChatgptRenderStateArgsSchema } from "./agent-gateway-schemas.ts";
import {
  type AskGatewayDeps,
  readGatewayErrorMessage,
  readGatewayJsonOutput,
  readMcpTextFromGatewayReply,
} from "./ask-gateway-server.ts";

export type ChatgptGatewayTool = "chatgpt_render_state";

const runOnChatGptPage = async <T>(
  deps: AskGatewayDeps,
  pageOperation: (page: Page) => Promise<T>,
): Promise<AskToolResult> => {
  const isWithChatGptPageMissing = deps.withChatGptPage === undefined;
  if (isWithChatGptPageMissing) {
    return {
      ok: false,
      output:
        "ChatGPT tools are not available in this gateway (no browser-backed ChatGPT session).",
    };
  }

  try {
    const pageOutcome = await deps.withChatGptPage(pageOperation);
    return { ok: true, output: readGatewayJsonOutput(pageOutcome) };
  } catch (error) {
    return { ok: false, output: readGatewayErrorMessage(error) };
  }
};

// Never throws — missing session and page failures surface as `{ ok: false }`.
export const runChatgptGatewayCall = async (
  deps: AskGatewayDeps,
  tool: ChatgptGatewayTool,
  args: Record<string, unknown>,
): Promise<AskToolResult> => {
  switch (tool) {
    case "chatgpt_render_state": {
      const isAllTabsRequested = args.allTabs === true;
      if (isAllTabsRequested) {
        return runOnChatGptPage(deps, (page) => readAllChatGptTabRenderStatuses(page));
      }

      return runOnChatGptPage(deps, (page) => readChatGptRenderStatus(page));
    }
  }
};

export const registerChatgptGatewayTools = (mcp: McpServer, deps: AskGatewayDeps): void => {
  mcp.registerTool(
    "chatgpt_render_state",
    {
      description:
        "Inspect the current ChatGPT render: streaming?, generated-image progress (loaded/pending), misfire and rate/cap-limit signals, and the latest assistant text. Pass allTabs:true to sweep every ChatGPT tab in the browser.",
      inputSchema: ChatgptRenderStateArgsSchema.shape,
    },
    async (args: Record<string, unknown>) =>
      readMcpTextFromGatewayReply(await runChatgptGatewayCall(deps, "chatgpt_render_state", args)),
  );
};
