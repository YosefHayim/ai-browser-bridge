import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Page } from "playwright";
import { DEFAULT_PERMISSION_MODE } from "@/config.ts";
import type { HookDefinition } from "@/features/hooks/hooks.ts";
import { runHooks } from "@/features/hooks/hooks.ts";
import { appendBridgeLog } from "@/features/repoState/logging.ts";
import { effectSchemaToMcpShape } from "@/mcpSchema.ts";
import { toolRegistry } from "./repoTools.ts";
import type { RepoToolDefinition, RepoToolResult } from "./toolDefinition.ts";
import type { PermissionMode } from "./toolPermissions.ts";
import { evaluateToolPermission, permissionDecisionToToolResult } from "./toolPermissions.ts";

export type McpToolAction = {
  name: string;
  status: "started" | "completed" | "blocked" | "failed";
  data?: Record<string, unknown>;
};

export type RepoMcpOptions = {
  getPage?: () => Page | null | undefined;
  getPermissionMode?: () => PermissionMode;
  hooks?: readonly HookDefinition[];
  onToolAction?: (action: McpToolAction) => void | Promise<void>;
};

export type RepoMcpHandle = {
  url: string;
  close: () => void;
};

type McpConnection = {
  server: McpServer;
  transport: SSEServerTransport;
};

type StreamableMcpConnection = {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
};

const toolActionStatus = (
  toolResult: RepoToolResult,
  blocked: boolean,
): McpToolAction["status"] => {
  if (blocked) return "blocked";
  if (toolResult.ok) return "completed";
  return "failed";
};

const sanitizeToolArgs = (toolRequest: Record<string, unknown>): Record<string, unknown> => {
  const publicArgs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(toolRequest)) {
    if (key === "_repoRoot") continue;
    publicArgs[key] = value;
  }
  return publicArgs;
};

const hooksForOptions = (options: RepoMcpOptions): readonly HookDefinition[] => {
  if (options.hooks === undefined) return [];
  return options.hooks;
};

const permissionModeForOptions = (options: RepoMcpOptions): PermissionMode => {
  if (options.getPermissionMode === undefined) return DEFAULT_PERMISSION_MODE;
  return options.getPermissionMode();
};

const handleToolCall = async (input: {
  repoRoot: string;
  options: RepoMcpOptions;
  name: string;
  tool: { handler: (toolRequest: Record<string, unknown>) => Promise<RepoToolResult> };
  args: Record<string, unknown>;
}) => {
  const hooks = hooksForOptions(input.options);
  await Promise.allSettled([runHooks("PreToolUse", hooks)]);
  const toolResult = await executeToolCall(input);
  await Promise.allSettled([runHooks("PostToolUse", hooks)]);
  return {
    content: [{ type: "text" as const, text: toolResult.output }],
    isError: !toolResult.ok,
  };
};

const executeToolCall = async (input: {
  repoRoot: string;
  options: RepoMcpOptions;
  name: string;
  tool: { handler: (toolRequest: Record<string, unknown>) => Promise<RepoToolResult> };
  args: Record<string, unknown>;
}): Promise<RepoToolResult> => {
  await logToolCallStart(input);
  const denied = permissionDecisionToToolResult(
    evaluateToolPermission(input.name, permissionModeForOptions(input.options)),
  );
  const toolResult = await invokeToolHandler({ ...input, denied });
  await logToolCallEnd({ params: input, toolResult, blocked: denied !== undefined });
  return toolResult;
};

const invokeToolHandler = async (input: {
  repoRoot: string;
  options: RepoMcpOptions;
  name: string;
  tool: { handler: (toolRequest: Record<string, unknown>) => Promise<RepoToolResult> };
  args: Record<string, unknown>;
  denied?: RepoToolResult;
}): Promise<RepoToolResult> => {
  if (input.denied !== undefined) return input.denied;
  try {
    return await callToolHandler(input);
  } catch (error) {
    return {
      ok: false,
      output: error instanceof Error ? error.message : String(error),
      error: "tool-handler-error",
    };
  }
};

const callToolHandler = async (input: {
  repoRoot: string;
  options: RepoMcpOptions;
  tool: { handler: (toolRequest: Record<string, unknown>) => Promise<RepoToolResult> };
  args: Record<string, unknown>;
}): Promise<RepoToolResult> => {
  if (input.options.getPage === undefined) {
    return await input.tool.handler({
      ...input.args,
      _repoRoot: input.repoRoot,
    });
  }
  const page = input.options.getPage();
  if (page === undefined || page === null) {
    return await input.tool.handler({
      ...input.args,
      _repoRoot: input.repoRoot,
    });
  }
  return await input.tool.handler({
    ...input.args,
    _repoRoot: input.repoRoot,
    _page: page,
  });
};

const logToolCallStart = async (input: {
  repoRoot: string;
  options: RepoMcpOptions;
  name: string;
  args: Record<string, unknown>;
}): Promise<void> => {
  const publicArgs = sanitizeToolArgs(input.args);
  await Promise.allSettled([
    appendBridgeLog({
      repoPath: input.repoRoot,
      type: "mcp_tool_call",
      data: { name: input.name, args: publicArgs },
    }),
  ]);
  if (input.options.onToolAction === undefined) return;
  await input.options.onToolAction({
    name: input.name,
    status: "started",
    data: { args: publicArgs },
  });
};

const logToolCallEnd = async (input: {
  params: { repoRoot: string; options: RepoMcpOptions; name: string };
  toolResult: RepoToolResult;
  blocked: boolean;
}): Promise<void> => {
  await Promise.allSettled([
    appendBridgeLog({
      repoPath: input.params.repoRoot,
      type: "mcp_tool_result",
      data: {
        name: input.params.name,
        ok: input.toolResult.ok,
        outputBytes: input.toolResult.output.length,
        error: input.toolResult.error,
      },
    }),
  ]);
  if (input.params.options.onToolAction === undefined) return;
  await input.params.options.onToolAction({
    name: input.params.name,
    status: toolActionStatus(input.toolResult, input.blocked),
    data: {
      ok: input.toolResult.ok,
      error: input.toolResult.error,
      outputBytes: input.toolResult.output.length,
    },
  });
};

const mcpProtocolServer = (repoRoot: string, options: RepoMcpOptions): McpServer => {
  const mcp = new McpServer({ name: "ai-browser-bridge", version: "0.1.0" });
  for (const [name, tool] of toolRegistry) {
    const toolConfig =
      tool.annotations === undefined
        ? {
            description: tool.description,
            inputSchema: effectSchemaToMcpShape(tool.argsSchema),
          }
        : {
            description: tool.description,
            inputSchema: effectSchemaToMcpShape(tool.argsSchema),
            annotations: tool.annotations,
          };
    mcp.registerTool(name, toolConfig, async (toolRequest: Record<string, unknown>) => {
      return handleToolCall({ repoRoot, options, name, tool, args: toolRequest });
    });
  }
  return mcp;
};

export const isSseEndpointPath = (pathname: string): boolean => {
  return pathname === "/" || pathname === "/sse" || pathname === "/sse/";
};

export const isStreamableHttpEndpointPath = (pathname: string): boolean => {
  return pathname === "/mcp" || pathname === "/mcp/";
};

const requestPathname = (url: string | undefined): string => {
  const requestUrl = url === undefined ? "/" : url;
  try {
    return new URL(requestUrl, "http://localhost").pathname;
  } catch {
    return "/";
  }
};

const requestHeader = (value: string | string[] | undefined): string | undefined => {
  if (Array.isArray(value)) return value[0];
  return value;
};

const readRequestJson = async (httpRequest: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of httpRequest) {
    if (Buffer.isBuffer(chunk)) {
      chunks.push(chunk);
    } else {
      chunks.push(Buffer.from(chunk));
    }
  }
  const rawText = Buffer.concat(chunks).toString("utf-8");
  if (rawText.length === 0) return undefined;
  return JSON.parse(rawText);
};

const writeJsonRpcError = (httpResponse: ServerResponse, status: number, message: string): void => {
  httpResponse.writeHead(status, { "Content-Type": "application/json" }).end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message },
      id: null,
    }),
  );
};

const writeSseProxyFlushPadding = (httpResponse: ServerResponse): void => {
  if (httpResponse.writableEnded) return;
  httpResponse.write(`: ${" ".repeat(2048)}\n\n`);
};

export class RepoMcpServer {
  private readonly repoRoot: string;
  private readonly options: RepoMcpOptions;
  private httpServer: ReturnType<typeof createServer> | null = null;
  private readonly connections = new Map<string, McpConnection>();
  private readonly streamableConnections = new Map<string, StreamableMcpConnection>();

  constructor(repoRoot: string, options: RepoMcpOptions = {}) {
    this.repoRoot = repoRoot;
    this.options = options;
  }

  async start(port: number): Promise<string> {
    this.httpServer = createServer((httpRequest, httpResponse) => {
      void this.handleRequest(httpRequest, httpResponse);
    });
    await this.listenOnPort(port);
    return `http://localhost:${port}`;
  }

  stop(): void {
    this.closeAllConnections(this.connections);
    this.closeAllConnections(this.streamableConnections);
    if (this.httpServer !== null) this.httpServer.close();
    this.httpServer = null;
  }

  async handleRequest(httpRequest: IncomingMessage, httpResponse: ServerResponse): Promise<void> {
    const pathname = requestPathname(httpRequest.url);
    if (isStreamableHttpEndpointPath(pathname)) {
      await this.handleStreamableHttpRequest(httpRequest, httpResponse);
      return;
    }
    if (isSseEndpointPath(pathname)) {
      await this.handleSseRequest(httpResponse);
      return;
    }
    if (pathname === "/messages" && httpRequest.method === "POST") {
      await this.handleSsePostMessage(httpRequest, httpResponse);
      return;
    }
    httpResponse.writeHead(404).end("Not found");
  }

  listTools(): RepoToolDefinition[] {
    return [...toolRegistry.values()];
  }

  private async listenOnPort(port: number): Promise<void> {
    const server = this.httpServer;
    if (server === null) throw new Error("HTTP server not initialized");
    const listenError = await new Promise<Error | undefined>((settle) => {
      const onError = (err: Error) => settle(err);
      server.once("error", onError);
      server.listen(port, () => {
        server.off("error", onError);
        settle(undefined);
      });
    });
    if (listenError !== undefined) throw listenError;
  }

  private closeAllConnections(
    connections: Map<string, McpConnection | StreamableMcpConnection>,
  ): void {
    void Promise.allSettled(
      [...connections.values()].map((connection) => connection.server.close()),
    );
    connections.clear();
  }

  private async handleSseRequest(httpResponse: ServerResponse): Promise<void> {
    const transport = new SSEServerTransport("/messages", httpResponse);
    const mcp = mcpProtocolServer(this.repoRoot, this.options);
    this.connections.set(transport.sessionId, { server: mcp, transport });
    transport.onclose = () => this.connections.delete(transport.sessionId);
    try {
      await mcp.connect(transport);
      writeSseProxyFlushPadding(httpResponse);
    } catch (error) {
      this.connections.delete(transport.sessionId);
      if (!httpResponse.headersSent) {
        httpResponse.writeHead(500).end(error instanceof Error ? error.message : String(error));
      }
    }
  }

  private async handleSsePostMessage(
    httpRequest: IncomingMessage,
    httpResponse: ServerResponse,
  ): Promise<void> {
    const requestUrl = httpRequest.url === undefined ? "/" : httpRequest.url;
    const sessionId = new URL(requestUrl, "http://localhost").searchParams.get("sessionId");
    if (sessionId === null) {
      httpResponse.writeHead(503).end("No active SSE connection");
      return;
    }
    const connection = this.connections.get(sessionId);
    if (connection === undefined) {
      httpResponse.writeHead(503).end("No active SSE connection");
      return;
    }
    await connection.transport.handlePostMessage(httpRequest, httpResponse);
  }

  private async handleStreamableHttpRequest(
    httpRequest: IncomingMessage,
    httpResponse: ServerResponse,
  ): Promise<void> {
    const sessionId = requestHeader(httpRequest.headers["mcp-session-id"]);
    let connection: StreamableMcpConnection | undefined;
    if (sessionId !== undefined) {
      connection = this.streamableConnections.get(sessionId);
    }
    let parsedRequest: unknown;
    if (connection === undefined) {
      const opened = await this.openStreamableInitialize(httpRequest, httpResponse);
      if (opened === null) return;
      connection = opened.connection;
      parsedRequest = opened.parsedRequest;
    }
    try {
      await connection.transport.handleRequest(httpRequest, httpResponse, parsedRequest);
    } catch (error) {
      if (!httpResponse.headersSent) {
        writeJsonRpcError(
          httpResponse,
          500,
          error instanceof Error ? error.message : "Internal server error",
        );
      }
    }
  }

  private async openStreamableInitialize(
    httpRequest: IncomingMessage,
    httpResponse: ServerResponse,
  ): Promise<{ connection: StreamableMcpConnection; parsedRequest: unknown } | null> {
    const sessionId = requestHeader(httpRequest.headers["mcp-session-id"]);
    if (sessionId !== undefined) {
      writeJsonRpcError(httpResponse, 404, "Session not found");
      return null;
    }
    if (httpRequest.method !== "POST") {
      writeJsonRpcError(httpResponse, 400, "Bad Request: No valid session ID provided");
      return null;
    }
    const parsedRequest = await readRequestJson(httpRequest);
    if (!isInitializeRequest(parsedRequest)) {
      writeJsonRpcError(httpResponse, 400, "Bad Request: No valid session ID provided");
      return null;
    }
    const connection = await this.openStreamableConnection();
    return { connection, parsedRequest };
  }

  private async openStreamableConnection(): Promise<StreamableMcpConnection> {
    let streamableConnection: StreamableMcpConnection | null = null;
    const transport = new StreamableHTTPServerTransport({
      enableJsonResponse: true,
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (newSessionId) => {
        if (streamableConnection !== null) {
          this.streamableConnections.set(newSessionId, streamableConnection);
        }
      },
    });
    streamableConnection = {
      server: mcpProtocolServer(this.repoRoot, this.options),
      transport,
    };
    transport.onclose = () => {
      const closedSessionId = transport.sessionId;
      if (closedSessionId !== undefined) this.streamableConnections.delete(closedSessionId);
    };
    await streamableConnection.server.connect(transport);
    return streamableConnection;
  }
}

export const startRepoMcpServer = (
  repoRoot: string,
  port: number,
  options: RepoMcpOptions = {},
): Promise<RepoMcpHandle> => {
  const server = new RepoMcpServer(repoRoot, options);
  return server.start(port).then((url) => ({ url, close: () => server.stop() }));
};
