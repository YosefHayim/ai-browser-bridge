import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Page } from "playwright";
import packageJson from "@/../package.json" with { type: "json" };
import {
  type AskToolArguments,
  AskToolArgumentsSchema,
  type AskToolReport,
  type SearchConversationsArguments,
  SearchConversationsArgumentsSchema,
} from "@/agent-gateway/agent-gateway-schemas.ts";
import { registerChatgptGatewayTools } from "@/agent-gateway/chatgpt-gateway-tools.ts";
import { DesignGatewayTools } from "@/agent-gateway/design-gateway-tools.ts";
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

function readFailureReport(error: unknown): AskToolReport {
  return { ok: false, output: readErrorMessage(error) };
}

export class AskGateway {
  constructor(private readonly collaborators: AskGatewayCollaborators) {}

  createServer = (): McpServer => {
    const mcpServer = new McpServer({
      name: "ai-browser-bridge-ask",
      version: packageJson.version,
    });

    mcpServer.registerTool(
      "ask",
      {
        description:
          "Drive web chats: one prompt fanned across providers, or a `tasks` array of independent Conversations run in parallel (new or resumed). Returns an ordered, paginated result — one row per task with its reply and reopenable Conversation id/url.",
        inputSchema: AskToolArgumentsSchema.shape,
      },
      this.answerAsk,
    );
    mcpServer.registerTool(
      "search_conversations",
      {
        description:
          "Search provider conversation history by title/id and return matching conversation URLs.",
        inputSchema: SearchConversationsArgumentsSchema.shape,
      },
      this.answerConversationSearch,
    );
    registerFlowGatewayTools(mcpServer, this.collaborators);
    registerChatgptGatewayTools(mcpServer, this.collaborators);
    new DesignGatewayTools(this.collaborators).registerTools(mcpServer);

    return mcpServer;
  };

  runAsk = async (toolArguments: AskToolArguments): Promise<AskToolReport> => {
    try {
      const tasks = listGatewayTasks(toolArguments);
      const fanOutSettings = readGatewayFanOutSettings(toolArguments);
      const fanOutReport = await this.collaborators.fanOut(tasks, fanOutSettings);

      return { ok: true, output: readGatewayDocumentPrintout(fanOutReport) };
    } catch (error) {
      return readFailureReport(error);
    }
  };

  runConversationSearch = async (
    toolArguments: SearchConversationsArguments,
  ): Promise<AskToolReport> => {
    const searchConversations = this.collaborators.searchConversations;

    const isSearchConversationsMissing = searchConversations == null;
    if (isSearchConversationsMissing) {
      return { ok: false, output: "Conversation search is not available in this gateway." };
    }

    try {
      const providers = listProviderIdsFrom(toolArguments.providers);
      const searchReport = await searchConversations(providers, toolArguments.query, {
        limit: toolArguments.limit,
      });

      return { ok: true, output: readGatewayDocumentPrintout(searchReport) };
    } catch (error) {
      return readFailureReport(error);
    }
  };

  // MCP SDK already validated against AskToolArgumentsSchema at the wire edge.
  private answerAsk = async (toolArguments: AskToolArguments) => {
    try {
      const gatewayReply = await this.runAsk(toolArguments);
      return readMcpReplyMessage(gatewayReply);
    } catch (error) {
      return readMcpFailureReply(error);
    }
  };

  // MCP SDK already validated against SearchConversationsArgumentsSchema at the wire edge.
  private answerConversationSearch = async (toolArguments: SearchConversationsArguments) => {
    try {
      const gatewayReply = await this.runConversationSearch(toolArguments);
      return readMcpReplyMessage(gatewayReply);
    } catch (error) {
      return readMcpFailureReply(error);
    }
  };
}
