import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type AskToolReport,
  ChatgptRenderStatusArgumentsSchema,
} from "@/agent-gateway/agent-gateway-schemas.ts";
import type { AskGatewayCollaborators } from "@/agent-gateway/ask-gateway.ts";
import { readMcpFailureReply, readMcpReplyMessage } from "@/agent-gateway/gateway-replies.ts";
import { runOnProviderPage } from "@/agent-gateway/run-on-provider-page.ts";
import {
  readAllChatGptTabRenderStatuses,
  readChatGptRenderStatus,
} from "@/providers/chatgpt/page/chatgpt-render-state.ts";

const CHATGPT_RENDER_STATUS_TOOL_NAME = "chatgpt_render_state";

export type ChatgptGatewayTool = "chatgpt_render_state";

export async function runChatgptGatewayCall(
  collaborators: AskGatewayCollaborators,
  tool: ChatgptGatewayTool,
  toolArguments: Record<string, unknown>,
): Promise<AskToolReport> {
  switch (tool) {
    case CHATGPT_RENDER_STATUS_TOOL_NAME: {
      const isAllTabsRequested = toolArguments.allTabs === true;
      if (isAllTabsRequested) {
        return runOnProviderPage(collaborators, "chatgpt", (page) =>
          readAllChatGptTabRenderStatuses(page),
        );
      }

      return runOnProviderPage(collaborators, "chatgpt", (page) => readChatGptRenderStatus(page));
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
