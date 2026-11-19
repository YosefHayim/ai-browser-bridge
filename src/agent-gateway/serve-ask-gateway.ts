import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AskGateway, type AskGatewayCollaborators } from "@/agent-gateway/ask-gateway.ts";

// stdout is the JSON-RPC channel; any stray stdout line corrupts it.
export async function serveAskGatewayStdio(collaborators: AskGatewayCollaborators): Promise<void> {
  const mcpServer = new AskGateway(collaborators).createServer();
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
}
