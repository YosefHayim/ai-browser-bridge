import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { type AskGatewayDeps, createAskGatewayServer } from "./askGatewayServer.ts";

/**
 * Serve the outbound `ask` MCP gateway over stdio and block until the transport
 * closes (the client disconnects, or the process is signalled).
 *
 * This is the composition-root entry the `ask` server was designed for: a local
 * agent (Claude Code, Cursor, …) spawns `bridge serve`, speaks MCP over stdio, and
 * calls the `ask` tool to drive one or more web chats. The browser-backed
 * `runFanout` is injected via {@link AskGatewayDeps}, so this stays transport-only.
 *
 * stdout is the JSON-RPC channel — the caller MUST redirect logs to stderr before
 * invoking this, or any stray stdout line corrupts the protocol stream.
 *
 * @param deps - Dependencies supplied by the caller.
 * @returns Completes when `serveAskGatewayStdio` finishes.
 * @example
 * ```ts
 * await serveAskGatewayStdio(deps);
 * ```
 */
export const serveAskGatewayStdio = async (deps: AskGatewayDeps): Promise<void> => {
  const server = createAskGatewayServer(deps);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  await new Promise<void>((resolve) => {
    // `connect` installs the SDK's own onclose; chain ours so cleanup still runs.
    const priorOnClose = transport.onclose;
    transport.onclose = () => {
      priorOnClose?.();
      resolve();
    };
  });
};
