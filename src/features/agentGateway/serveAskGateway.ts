import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { type AskGatewayDeps, createAskGatewayServer } from "./askGatewayServer.ts";

/**
 * Serve the outbound `ask` MCP gateway over stdio until the transport closes.
 *
 * stdout is the JSON-RPC channel — callers MUST redirect logs to stderr before
 * invoking this, or any stray stdout line corrupts the protocol stream.
 */
export const serveAskGatewayStdio = async (deps: AskGatewayDeps): Promise<void> => {
  const server = createAskGatewayServer(deps);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  await new Promise<void>((resolve) => {
    // `connect` installs the SDK's own onclose; chain ours so cleanup still runs.
    const priorOnClose = transport.onclose;
    transport.onclose = () => {
      if (priorOnClose !== undefined) priorOnClose();
      resolve();
    };
  });
};
