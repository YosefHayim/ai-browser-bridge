import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Page } from "playwright";
import {
  readAllChatGptTabRenderStatuses,
  readChatGptRenderStatus,
} from "@/providers/chatgpt/chatgpt-render-state.ts";
import { type AskToolReport, ChatgptRenderStatusArgumentsSchema } from "./agent-gateway-schemas.ts";
import type { AskGatewayCollaborators } from "./ask-gateway-server.ts";
import {
  readGatewayDocumentPrintout,
  readGatewayErrorMessage,
  readMcpReplyMessage,
} from "./gateway-replies.ts";

const CHATGPT_RENDER_STATUS_TOOL_NAME = "chatgpt_render_state";

export type ChatgptGatewayTool = "chatgpt_render_state";

const runOnChatGptPage = async <Reply>(
  collaborators: AskGatewayCollaborators,
  pageOperation: (page: Page) => Promise<Reply>,
): Promise<AskToolReport> => {
  const isWithChatGptPageMissing = collaborators.withChatGptPage == null;
  if (isWithChatGptPageMissing) {
    return {
      ok: false,
      output:
        "ChatGPT tools are not available in this gateway (no browser-backed ChatGPT session).",
    };
  }

  try {
    const pageReport = await collaborators.withChatGptPage(pageOperation);
    return { ok: true, output: readGatewayDocumentPrintout(pageReport) };
  } catch (error) {
    return { ok: false, output: readGatewayErrorMessage(error) };
  }
};

export const runChatgptGatewayCall = async (
  collaborators: AskGatewayCollaborators,
  tool: ChatgptGatewayTool,
  toolArguments: Record<string, unknown>,
): Promise<AskToolReport> => {
  switch (tool) {
    case CHATGPT_RENDER_STATUS_TOOL_NAME: {
      const isAllTabsRequested = toolArguments.allTabs === true;
      if (isAllTabsRequested) {
        return runOnChatGptPage(collaborators, (page) => readAllChatGptTabRenderStatuses(page));
      }

      return runOnChatGptPage(collaborators, (page) => readChatGptRenderStatus(page));
    }
  }
};

export const registerChatgptGatewayTools = (
  mcp: McpServer,
  collaborators: AskGatewayCollaborators,
): void => {
  mcp.registerTool(
    CHATGPT_RENDER_STATUS_TOOL_NAME,
    {
      description:
        "Inspect the current ChatGPT render: streaming?, generated-image progress (loaded/pending), misfire and rate/cap-limit signals, and the latest assistant text. Pass allTabs:true to sweep every ChatGPT tab in the browser.",
      inputSchema: ChatgptRenderStatusArgumentsSchema.shape,
    },
    async (toolArguments: Record<string, unknown>) =>
      readMcpReplyMessage(
        await runChatgptGatewayCall(collaborators, CHATGPT_RENDER_STATUS_TOOL_NAME, toolArguments),
      ),
  );
};
