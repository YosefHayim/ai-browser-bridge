import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { type AskGatewayDeps, askGatewayServerFor } from "./askGatewayServer.ts";

// stdout is the JSON-RPC channel — callers MUST redirect logs to stderr before
// invoking this, or any stray stdout line corrupts the protocol stream.
export const serveAskGatewayStdio = async (deps: AskGatewayDeps): Promise<void> => {
  const mcpServer = askGatewayServerFor(deps);
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  await new Promise<void>((resolve) => {
    // `connect` installs the SDK's own onclose; chain ours so cleanup still runs.
    const priorOnClose = transport.onclose;
    transport.onclose = () => {
      if (priorOnClose !== undefined) priorOnClose();
      resolve();
    };
  });
};
