import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Page } from "playwright";
import { appendBridgeLog } from "../core/logging.ts";
import { evaluateToolPermission, permissionDecisionToToolResult } from "../core/permissions.ts";
import { runHooks, type HookDefinition } from "../core/hooks.ts";
import { toolRegistry } from "./tools/registry.ts";
import type { BridgePermissionMode, ToolResult } from "../types/types.ts";

export interface McpToolAction {
  name: string;
  status: "started" | "completed" | "blocked" | "failed";
  data?: Record<string, unknown>;
}

export interface McpServerOptions {
  getPage?: () => Page | null | undefined;
  getPermissionMode?: () => BridgePermissionMode;
  hooks?: readonly HookDefinition[];
  onToolAction?: (action: McpToolAction) => void | Promise<void>;
}

interface McpConnection {
  server: McpServer;
  transport: SSEServerTransport;
}

interface StreamableMcpConnection {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
}

/**
 * Start the MCP server with SSE transport.
 *
 * Registers all tools from the tool registry and listens for
 * incoming connections from ChatGPT via the Cloudflare tunnel.
 */
export function startMcpServer(
  repoRoot: string,
  port: number,
  options: McpServerOptions = {},
): Promise<{ url: string; close: () => void }> {
  const httpServer = createServer();
  const connections = new Map<string, McpConnection>();
  const streamableConnections = new Map<string, StreamableMcpConnection>();

  httpServer.on("request", async (req, res) => {
    const pathname = requestPathname(req.url);
    if (isStreamableHttpEndpointPath(pathname)) {
      await handleStreamableHttpRequest(req, res, repoRoot, options, streamableConnections);
      return;
    }

    if (isSseEndpointPath(pathname)) {
      const transport = new SSEServerTransport("/messages", res);
      const mcp = createMcpProtocolServer(repoRoot, options);
      connections.set(transport.sessionId, { server: mcp, transport });
      transport.onclose = () => {
        connections.delete(transport.sessionId);
      };
      try {
        await mcp.connect(transport);
        writeSseProxyFlushPadding(res);
      } catch (error) {
        connections.delete(transport.sessionId);
        if (!res.headersSent) {
          res.writeHead(500).end(error instanceof Error ? error.message : String(error));
        }
      }
      return;
    }

    if (pathname === "/messages" && req.method === "POST") {
      const sessionId = requestSessionId(req.url);
      const connection = sessionId ? connections.get(sessionId) : undefined;
      if (connection) {
        await connection.transport.handlePostMessage(req, res);
      } else {
        res.writeHead(503).end("No active SSE connection");
      }
      return;
    }

    res.writeHead(404).end("Not found");
  });

  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      reject(err);
    };

    httpServer.once("error", onError);
    httpServer.listen(port, () => {
      httpServer.off("error", onError);
      const close = () => {
        for (const connection of connections.values()) {
          connection.server.close().catch(() => {});
        }
        connections.clear();
        for (const connection of streamableConnections.values()) {
          connection.server.close().catch(() => {});
        }
        streamableConnections.clear();
        httpServer.close();
      };
      resolve({ url: `http://localhost:${port}`, close });
    });
  });
}

async function handleStreamableHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  repoRoot: string,
  options: McpServerOptions,
  connections: Map<string, StreamableMcpConnection>,
): Promise<void> {
  const sessionId = requestHeader(req.headers["mcp-session-id"]);
  let connection = sessionId ? connections.get(sessionId) : undefined;
  let parsedBody: unknown;

  if (!connection) {
    if (sessionId) {
      writeJsonRpcError(res, 404, "Session not found");
      return;
    }

    if (req.method !== "POST") {
      writeJsonRpcError(res, 400, "Bad Request: No valid session ID provided");
      return;
    }

    parsedBody = await readJsonBody(req);
    if (!isInitializeRequest(parsedBody)) {
      writeJsonRpcError(res, 400, "Bad Request: No valid session ID provided");
      return;
    }

    let createdConnection: StreamableMcpConnection | null = null;
    const transport = new StreamableHTTPServerTransport({
      enableJsonResponse: true,
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (newSessionId) => {
        if (createdConnection) connections.set(newSessionId, createdConnection);
      },
    });
    const mcp = createMcpProtocolServer(repoRoot, options);
    createdConnection = { server: mcp, transport };
    connection = createdConnection;
    transport.onclose = () => {
      const closedSessionId = transport.sessionId;
      if (closedSessionId) connections.delete(closedSessionId);
    };
    await mcp.connect(transport);
  }

  try {
    await connection.transport.handleRequest(req, res, parsedBody);
  } catch (error) {
    if (!res.headersSent) {
      writeJsonRpcError(res, 500, error instanceof Error ? error.message : "Internal server error");
    }
  }
}

function createMcpProtocolServer(
  repoRoot: string,
  options: McpServerOptions,
): McpServer {
  const mcp = new McpServer({ name: "chatgpt-local-bridge", version: "0.1.0" });

  for (const [name, tool] of toolRegistry) {
    mcp.tool(
      name,
      tool.description,
      tool.parameters,
      tool.annotations ?? {},
      async (args: Record<string, unknown>) => {
        await runHooks("PreToolUse", options.hooks ?? []).catch(() => []);
        await appendBridgeLog({
          repoPath: repoRoot,
          type: "mcp_tool_call",
          data: { name, args: sanitizeToolArgs(args) },
        }).catch(() => {});
        await options.onToolAction?.({
          name,
          status: "started",
          data: { args: sanitizeToolArgs(args) },
        });

        const permission = evaluateToolPermission(name, options.getPermissionMode?.() ?? "auto");
        const denied = permissionDecisionToToolResult(permission);
        let result: ToolResult;
        try {
          const page = options.getPage?.();
          result = denied ?? await tool.handler({
            ...args,
            _repoRoot: repoRoot,
            ...(page ? { _page: page } : {}),
          });
        } catch (error) {
          result = {
            ok: false,
            output: error instanceof Error ? error.message : String(error),
            error: "tool-handler-error",
          };
        }

        await appendBridgeLog({
          repoPath: repoRoot,
          type: "mcp_tool_result",
          data: {
            name,
            ok: result.ok,
            outputBytes: result.output.length,
            error: result.error,
          },
        }).catch(() => {});
        await options.onToolAction?.({
          name,
          status: toolActionStatus(result, denied !== undefined),
          data: {
            ok: result.ok,
            error: result.error,
            outputBytes: result.output.length,
          },
        });
        await runHooks("PostToolUse", options.hooks ?? []).catch(() => []);
        return {
          content: [{ type: "text" as const, text: result.output }],
          isError: !result.ok,
        };
      },
    );
  }

  return mcp;
}

export function isSseEndpointPath(pathname: string): boolean {
  return pathname === "/" || pathname === "/sse" || pathname === "/sse/";
}

export function isStreamableHttpEndpointPath(pathname: string): boolean {
  return pathname === "/mcp" || pathname === "/mcp/";
}

function requestPathname(url: string | undefined): string {
  try {
    return new URL(url ?? "/", "http://localhost").pathname;
  } catch {
    return "/";
  }
}

function requestSessionId(url: string | undefined): string | null {
  try {
    return new URL(url ?? "/", "http://localhost").searchParams.get("sessionId");
  } catch {
    return null;
  }
}

function requestHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf-8");
  return raw ? JSON.parse(raw) : undefined;
}

function writeJsonRpcError(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message,
    },
    id: null,
  }));
}

function writeSseProxyFlushPadding(res: ServerResponse): void {
  if (res.writableEnded) return;
  res.write(`: ${" ".repeat(2048)}\n\n`);
}

function toolActionStatus(result: ToolResult, blocked: boolean): McpToolAction["status"] {
  if (blocked) return "blocked";
  return result.ok ? "completed" : "failed";
}

function sanitizeToolArgs(args: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (key === "_repoRoot") continue;
    clean[key] = value;
  }
  return clean;
}
