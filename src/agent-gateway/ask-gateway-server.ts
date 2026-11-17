import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Page } from "playwright";
import {
  type AskToolArguments,
  AskToolArgumentsSchema,
  type AskToolReport,
  type SearchConversationsArguments,
  SearchConversationsArgumentsSchema,
} from "@/agent-gateway/agent-gateway-schemas.ts";
import { registerChatgptGatewayTools } from "@/agent-gateway/chatgpt-gateway-tools.ts";
import { registerDesignGatewayTools } from "@/agent-gateway/design-gateway-tools.ts";
import { registerFlowGatewayTools } from "@/agent-gateway/flow-gateway-tools.ts";
import {
  readGatewayDocumentPrintout,
  readMcpFailureReply,
  readMcpReplyMessage,
} from "@/agent-gateway/gateway-replies.ts";
import type { FanOutTask } from "@/bridge-engine/bridge-schemas.ts";
import type { FanOutReport, FanOutSettings } from "@/fan-out/fan-out-pool.ts";
import { listProviderIdsFrom } from "@/providers/providers.ts";
import { readErrorMessage } from "@/read-error-message.ts";

export type AskGatewayCollaborators = {
  readonly repoRoot: string;
  readonly fanOut: (tasks: FanOutTask[], settings: FanOutSettings) => Promise<FanOutReport>;
  readonly searchConversations?: (
    providers: string[],
    query: string,
    settings: { limit?: number },
  ) => Promise<Record<string, unknown>>;
  // Absent without a Flow session — flow_* tools report that cleanly.
  readonly withFlowPage?: <Reply>(runPage: (page: Page) => Promise<Reply>) => Promise<Reply>;
  // Absent without a ChatGPT session — chatgpt_* tools report that cleanly.
  readonly withChatGptPage?: <Reply>(runPage: (page: Page) => Promise<Reply>) => Promise<Reply>;
  // Absent without a Claude Design session — design_* tools report that cleanly.
  readonly withDesignPage?: <Reply>(runPage: (page: Page) => Promise<Reply>) => Promise<Reply>;
};

function listGatewayTasks(toolArguments: AskToolArguments): FanOutTask[] {
  const tasks = toolArguments.tasks ?? [];

  const hasTasks = tasks.length > 0;
  if (hasTasks) return [...tasks];

  const prompt = toolArguments.prompt;

  const isPromptMissing = prompt == null;
  if (isPromptMissing) {
    throw new Error("Provide `prompt` (with optional `providers`) or a non-empty `tasks` array.");
  }

  return listProviderIdsFrom(toolArguments.providers).map((provider) => ({ prompt, provider }));
}

function readGatewayFanOutSettings(toolArguments: AskToolArguments): FanOutSettings {
  const fanOutSettings: FanOutSettings = {};

  const timeoutSeconds = toolArguments.timeoutSeconds;

  const hasTimeoutSeconds = timeoutSeconds != null;
  if (hasTimeoutSeconds) {
    const millisecondsPerSecond = 1000;

    fanOutSettings.timeoutMilliseconds = timeoutSeconds * millisecondsPerSecond;
  }

  const hasMaxConcurrency = toolArguments.maxConcurrency != null;
  if (hasMaxConcurrency) {
    fanOutSettings.maxConcurrency = toolArguments.maxConcurrency;
  }

  const hasLimit = toolArguments.limit != null;
  if (hasLimit) {
    fanOutSettings.limit = toolArguments.limit;
  }

  const hasOffset = toolArguments.offset != null;
  if (hasOffset) {
    fanOutSettings.offset = toolArguments.offset;
  }

  const hasMaxReplyChars = toolArguments.maxReplyChars != null;
  if (hasMaxReplyChars) {
    fanOutSettings.maxReplyChars = toolArguments.maxReplyChars;
  }

  return fanOutSettings;
}

export async function runAskGatewayCall(
  collaborators: AskGatewayCollaborators,
  toolArguments: AskToolArguments,
): Promise<AskToolReport> {
  let tasks: FanOutTask[];

  try {
    tasks = listGatewayTasks(toolArguments);
  } catch (thrown) {
    return { ok: false, output: readErrorMessage(thrown) };
  }

  const fanOutSettings = readGatewayFanOutSettings(toolArguments);
  const fanOutReport = await collaborators.fanOut(tasks, fanOutSettings);

  return { ok: true, output: readGatewayDocumentPrintout(fanOutReport) };
}

export async function runConversationSearchGatewayCall(
  collaborators: AskGatewayCollaborators,
  toolArguments: SearchConversationsArguments,
): Promise<AskToolReport> {
  const isSearchConversationsMissing = collaborators.searchConversations == null;
  if (isSearchConversationsMissing) {
    return { ok: false, output: "Conversation search is not available in this gateway." };
  }

  let providers: string[];
  try {
    providers = listProviderIdsFrom(toolArguments.providers);
  } catch (thrown) {
    return { ok: false, output: readErrorMessage(thrown) };
  }
  const searchReport = await collaborators.searchConversations(providers, toolArguments.query, {
    limit: toolArguments.limit,
  });
  return { ok: true, output: readGatewayDocumentPrintout(searchReport) };
}

export function createAskGatewayServer(collaborators: AskGatewayCollaborators): McpServer {
  const mcpServer = new McpServer({ name: "ai-browser-bridge-ask", version: "0.1.0" });

  mcpServer.registerTool(
    "ask",
    {
      description:
        "Drive web chats: one prompt fanned across providers, or a `tasks` array of independent Conversations run in parallel (new or resumed). Returns an ordered, paginated result — one row per task with its reply and reopenable Conversation id/url.",
      inputSchema: AskToolArgumentsSchema.shape,
    },
    async (toolArguments) => {
      // MCP SDK already validated against AskToolArgsSchema at the wire edge.
      try {
        const gatewayReply = await runAskGatewayCall(collaborators, toolArguments);
        return readMcpReplyMessage(gatewayReply);
      } catch (error) {
        return readMcpFailureReply(error);
      }
    },
  );
  mcpServer.registerTool(
    "search_conversations",
    {
      description:
        "Search provider conversation history by title/id and return matching conversation URLs.",
      inputSchema: SearchConversationsArgumentsSchema.shape,
    },
    async (toolArguments) => {
      // MCP SDK already validated against SearchConversationsArgsSchema at the wire edge.
      try {
        const gatewayReply = await runConversationSearchGatewayCall(collaborators, toolArguments);
        return readMcpReplyMessage(gatewayReply);
      } catch (error) {
        return readMcpFailureReply(error);
      }
    },
  );
  registerFlowGatewayTools(mcpServer, collaborators);
  registerChatgptGatewayTools(mcpServer, collaborators);
  registerDesignGatewayTools(mcpServer, collaborators);

  return mcpServer;
}
