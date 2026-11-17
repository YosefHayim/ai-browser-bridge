import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Page } from "playwright";
import {
  type AskToolReport,
  ChatgptRenderStatusArgumentsSchema,
} from "@/agent-gateway/agent-gateway-schemas.ts";
import type { AskGatewayCollaborators } from "@/agent-gateway/ask-gateway-server.ts";
import {
  readGatewayDocumentPrintout,
  readMcpFailureReply,
  readMcpReplyMessage,
} from "@/agent-gateway/gateway-replies.ts";
import {
  readAllChatGptTabRenderStatuses,
  readChatGptRenderStatus,
} from "@/providers/chatgpt/page/chatgpt-render-state.ts";
import { readErrorMessage } from "@/read-error-message.ts";

const CHATGPT_RENDER_STATUS_TOOL_NAME = "chatgpt_render_state";

export type ChatgptGatewayTool = "chatgpt_render_state";

async function runOnChatGptPage<Reply>(
  collaborators: AskGatewayCollaborators,
  pageOperation: (page: Page) => Promise<Reply>,
): Promise<AskToolReport> {
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
    return { ok: false, output: readErrorMessage(error) };
  }
}

export async function runChatgptGatewayCall(
  collaborators: AskGatewayCollaborators,
  tool: ChatgptGatewayTool,
  toolArguments: Record<string, unknown>,
): Promise<AskToolReport> {
  switch (tool) {
    case CHATGPT_RENDER_STATUS_TOOL_NAME: {
      const isAllTabsRequested = toolArguments.allTabs === true;
      if (isAllTabsRequested) {
        return runOnChatGptPage(collaborators, (page) => readAllChatGptTabRenderStatuses(page));
      }

      return runOnChatGptPage(collaborators, (page) => readChatGptRenderStatus(page));
    }
  }
}

export function registerChatgptGatewayTools(
  mcp: McpServer,
  collaborators: AskGatewayCollaborators,
): void {
  mcp.registerTool(
    CHATGPT_RENDER_STATUS_TOOL_NAME,
    {
      description:
        "Inspect the current ChatGPT render: streaming?, generated-image progress (loaded/pending), misfire and rate/cap-limit signals, and the latest assistant text. Pass allTabs:true to sweep every ChatGPT tab in the browser.",
      inputSchema: ChatgptRenderStatusArgumentsSchema.shape,
    },
    async (toolArguments: Record<string, unknown>) => {
      try {
        const chatgptReply = await runChatgptGatewayCall(
          collaborators,
          CHATGPT_RENDER_STATUS_TOOL_NAME,
          toolArguments,
        );
        return readMcpReplyMessage(chatgptReply);
      } catch (error) {
        return readMcpFailureReply(error);
      }
    },
  );
}
