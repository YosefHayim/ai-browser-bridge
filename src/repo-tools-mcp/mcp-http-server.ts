import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { readErrorMessage } from "@/read-error-message.ts";
import type { McpServerHandle, McpServerSettings } from "@/repo-tools-mcp/mcp-server-types.ts";
import { RepoToolsServer } from "@/repo-tools-mcp/repo-tools-server.ts";

const HTTP_POST_METHOD = "POST";

const HTTP_BAD_REQUEST_STATUS = 400;

const HTTP_SERVICE_UNAVAILABLE_STATUS = 503;

const HTTP_INTERNAL_SERVER_ERROR_STATUS = 500;

const HTTP_NOT_FOUND_STATUS = 404;

const MESSAGES_PATH = "/messages";

const LOCALHOST_BASE_URL = "http://localhost";

const NO_ACTIVE_SSE_CONNECTION_MESSAGE = "No active SSE connection";

const NO_VALID_SESSION_ID_MESSAGE = "Bad Request: No valid session ID provided";

const ERROR_EVENT = "error";

type McpConnection = {
  server: McpServer;
  transport: SSEServerTransport;
};

type StreamableMcpConnection = {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
};

type StreamableRequestTarget = {
  connection: StreamableMcpConnection;
  parsedRequest?: unknown;
};

export function isSseEndpointPath(pathname: string): boolean {
  return ["/", "/sse", "/sse/"].includes(pathname);
}

export function isStreamableHttpEndpointPath(pathname: string): boolean {
  return ["/mcp", "/mcp/"].includes(pathname);
}

function requestPathname(url: string | undefined): string {
  const isUrlMissing = url == null;
  const requestUrl = isUrlMissing ? "/" : url;

  try {
    return new URL(requestUrl, LOCALHOST_BASE_URL).pathname;
  } catch {
    return "/";
  }
}

function requestHeader(field: string | string[] | undefined): string | null {
  const isHeaderList = Array.isArray(field);
  if (isHeaderList) return field[0] ?? null;

  return field ?? null;
}

async function readRequestDocument(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const chunkBuffer = Buffer.from(chunk);
    chunks.push(chunkBuffer);
  }

  const requestDocument = Buffer.concat(chunks).toString("utf-8");

  const isRequestEmpty = requestDocument.length === 0;
  if (isRequestEmpty) return null;

  return JSON.parse(requestDocument);
}

function writeDocumentRpcError(reply: ServerResponse, status: number, message: string): void {
  const rpcServerErrorCode = -32000;
  const serializedError = JSON.stringify({
    jsonrpc: "2.0",
    error: { code: rpcServerErrorCode, message },
    id: null,
  });

  reply.writeHead(status, { "Content-Type": "application/json" }).end(serializedError);
}

function writeSseProxyFlushPadding(reply: ServerResponse): void {
  const isReplyEnded = reply.writableEnded;
  if (isReplyEnded) return;

  const ssePaddingBytes = 2048;
  const padding = " ".repeat(ssePaddingBytes);

  reply.write(`: ${padding}\n\n`);
}

class McpHttpServer {
  private httpServer: ReturnType<typeof createServer> | null = null;
  private readonly connections = new Map<string, McpConnection>();
  private readonly streamableConnections = new Map<string, StreamableMcpConnection>();

  constructor(private readonly repoTools: RepoToolsServer) {}

  start = async (port: number): Promise<string> => {
    this.httpServer = createServer(this.runRequest);
    await this.listenOnPort(port);
    return `http://localhost:${port}`;
  };

  stop = (): void => {
    this.closeAllConnections(this.connections);
    this.closeAllConnections(this.streamableConnections);

    const runningHttpServer = this.httpServer;

    const isHttpServerRunning = runningHttpServer != null;
    if (isHttpServerRunning) runningHttpServer.close();

    this.httpServer = null;
  };

  private runRequest = async (request: IncomingMessage, reply: ServerResponse): Promise<void> => {
    try {
      await this.routeRequest(request, reply);
    } catch (error) {
      const isHeadersSent = reply.headersSent;
      if (isHeadersSent) return;

      reply.writeHead(HTTP_INTERNAL_SERVER_ERROR_STATUS).end(readErrorMessage(error));
    }
  };

  private routeRequest = async (request: IncomingMessage, reply: ServerResponse): Promise<void> => {
    const pathname = requestPathname(request.url);
    if (isStreamableHttpEndpointPath(pathname)) {
      await this.runStreamableHttpRequest(request, reply);
      return;
    }

    if (isSseEndpointPath(pathname)) {
      await this.runSseRequest(reply);
      return;
    }

    const isMessagesPath = pathname === MESSAGES_PATH;
    const isPostMethod = request.method === HTTP_POST_METHOD;
    const isSsePostMessage = [isMessagesPath, isPostMethod].every(Boolean);
    if (isSsePostMessage) {
      await this.runSsePostMessage(request, reply);
      return;
    }

    reply.writeHead(HTTP_NOT_FOUND_STATUS).end("Not found");
  };

  private listenOnPort = async (port: number): Promise<void> => {
    const server = this.httpServer;

    const isServerMissing = server == null;
    if (isServerMissing) throw new Error("HTTP server not initialized");

    const listenError = await new Promise<Error | null>((settle) => {
      function settleOnServerError(error: Error) {
        return settle(error);
      }

      server.once(ERROR_EVENT, settleOnServerError);
      server.listen(port, () => {
        server.off(ERROR_EVENT, settleOnServerError);
        settle(null);
      });
    });

    const hasListenError = listenError != null;
    if (hasListenError) throw listenError;
  };

  private closeAllConnections = (
    connections: Map<string, McpConnection | StreamableMcpConnection>,
  ): void => {
    const closingServers = [...connections.values()].map((connection) => connection.server.close());
    void Promise.allSettled(closingServers);
    connections.clear();
  };

  private runSseRequest = async (reply: ServerResponse): Promise<void> => {
    const transport = new SSEServerTransport(MESSAGES_PATH, reply);
    const mcp = this.repoTools.createProtocolServer();
    this.connections.set(transport.sessionId, { server: mcp, transport });
    transport.onclose = () => this.connections.delete(transport.sessionId);
    try {
      await mcp.connect(transport);
      writeSseProxyFlushPadding(reply);
    } catch (error) {
      this.connections.delete(transport.sessionId);

      const isNotHeadersSent = !reply.headersSent;
      if (isNotHeadersSent) {
        reply.writeHead(HTTP_INTERNAL_SERVER_ERROR_STATUS).end(readErrorMessage(error));
      }
    }
  };

  private runSsePostMessage = async (
    request: IncomingMessage,
    reply: ServerResponse,
  ): Promise<void> => {
    const requestUrl = request.url ?? "/";
    const messageUrl = new URL(requestUrl, LOCALHOST_BASE_URL);
    const sessionId = messageUrl.searchParams.get("sessionId");

    const isSessionIdMissing = sessionId == null;
    if (isSessionIdMissing) {
      reply.writeHead(HTTP_SERVICE_UNAVAILABLE_STATUS).end(NO_ACTIVE_SSE_CONNECTION_MESSAGE);
      return;
    }

    const connection = this.connections.get(sessionId);

    const isConnectionMissing = connection == null;
    if (isConnectionMissing) {
      reply.writeHead(HTTP_SERVICE_UNAVAILABLE_STATUS).end(NO_ACTIVE_SSE_CONNECTION_MESSAGE);
      return;
    }

    await connection.transport.handlePostMessage(request, reply);
  };

  private runStreamableHttpRequest = async (
    request: IncomingMessage,
    reply: ServerResponse,
  ): Promise<void> => {
    const sessionId = requestHeader(request.headers["mcp-session-id"]);
    const existingConnection = this.readStreamableConnection(sessionId);

    const isConnectionMissing = existingConnection == null;
    if (isConnectionMissing) {
      const opened = await this.openStreamableInitialize(request, reply);

      const isOpenedMissing = opened == null;
      if (isOpenedMissing) return;

      await this.answerStreamableRequest(request, reply, opened);
      return;
    }

    await this.answerStreamableRequest(request, reply, { connection: existingConnection });
  };

  private readStreamableConnection = (sessionId: string | null): StreamableMcpConnection | null => {
    const isSessionIdMissing = sessionId == null;
    if (isSessionIdMissing) return null;

    return this.streamableConnections.get(sessionId) ?? null;
  };

  private answerStreamableRequest = async (
    request: IncomingMessage,
    reply: ServerResponse,
    target: StreamableRequestTarget,
  ): Promise<void> => {
    try {
      await target.connection.transport.handleRequest(request, reply, target.parsedRequest);
    } catch (error) {
      const isNotHeadersSent = !reply.headersSent;
      if (isNotHeadersSent) {
        const isErrorObject = error instanceof Error;
        writeDocumentRpcError(
          reply,
          HTTP_INTERNAL_SERVER_ERROR_STATUS,
          isErrorObject ? error.message : "Internal server error",
        );
      }
    }
  };

  private openStreamableInitialize = async (
    request: IncomingMessage,
    reply: ServerResponse,
  ): Promise<StreamableRequestTarget | null> => {
    const sessionId = requestHeader(request.headers["mcp-session-id"]);

    const hasSessionId = sessionId != null;
    if (hasSessionId) {
      writeDocumentRpcError(reply, HTTP_NOT_FOUND_STATUS, "Session not found");
      return null;
    }

    const isNotPostRequest = request.method !== HTTP_POST_METHOD;
    if (isNotPostRequest) {
      writeDocumentRpcError(reply, HTTP_BAD_REQUEST_STATUS, NO_VALID_SESSION_ID_MESSAGE);
      return null;
    }

    const parsedRequest = await readRequestDocument(request);

    const isNotInitializeRequest = !isInitializeRequest(parsedRequest);
    if (isNotInitializeRequest) {
      writeDocumentRpcError(reply, HTTP_BAD_REQUEST_STATUS, NO_VALID_SESSION_ID_MESSAGE);
      return null;
    }

    const connection = await this.openStreamableConnection();
    return { connection, parsedRequest };
  };

  private openStreamableConnection = async (): Promise<StreamableMcpConnection> => {
    const transport = new StreamableHTTPServerTransport({
      enableJsonResponse: true,
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (newSessionId) => {
        this.streamableConnections.set(newSessionId, streamableConnection);
      },
    });
    const streamableConnection: StreamableMcpConnection = {
      server: this.repoTools.createProtocolServer(),
      transport,
    };
    transport.onclose = () => {
      const closedSessionId = transport.sessionId;

      const hasClosedSessionId = closedSessionId != null;
      if (hasClosedSessionId) this.streamableConnections.delete(closedSessionId);
    };
    await streamableConnection.server.connect(transport);
    return streamableConnection;
  };
}

export async function startMcpServer(
  repoRoot: string,
  port: number,
  settings: McpServerSettings = {},
): Promise<McpServerHandle> {
  const server = new McpHttpServer(new RepoToolsServer(repoRoot, settings));
  const startedUrl = await server.start(port);

  return { url: startedUrl, close: () => server.stop() };
}
