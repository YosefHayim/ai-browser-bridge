import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { type AskGatewayCollaborators, askGatewayServerFor } from "./ask-gateway-server.ts";

// stdout is the JSON-RPC channel — callers MUST redirect logs to stderr before
// invoking this, or any stray stdout line corrupts the protocol stream.
export const serveAskGatewayStdio = async (
  collaborators: AskGatewayCollaborators,
): Promise<void> => {
  const mcpServer = askGatewayServerFor(collaborators);
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  await new Promise<void>((fulfill) => {
    // `connect` installs the SDK's own onclose; chain ours so cleanup still runs.
    const priorOnClose = transport.onclose;
    transport.onclose = () => {
      const hasPriorOnClose = priorOnClose != null;
      if (hasPriorOnClose) priorOnClose();

      fulfill();
    };
  });
};
