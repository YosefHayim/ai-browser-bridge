import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { type AskGatewayCollaborators, createAskGatewayServer } from "./ask-gateway-server.ts";

// stdout is the JSON-RPC channel; any stray stdout line corrupts it.
export const serveAskGatewayStdio = async (
  collaborators: AskGatewayCollaborators,
): Promise<void> => {
  const mcpServer = createAskGatewayServer(collaborators);
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
