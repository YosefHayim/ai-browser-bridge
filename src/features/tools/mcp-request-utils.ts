import type { IncomingMessage, ServerResponse } from "node:http";

/** Parse the pathname from an HTTP request URL. */
export function requestPathname(url: string | undefined): string {
  try {
    return new URL(url ?? "/", "http://localhost").pathname;
  } catch {
    return "/";
  }
}

/** Read the SSE session id query parameter from a request URL. */
export function requestSessionId(url: string | undefined): string | null {
  try {
    return new URL(url ?? "/", "http://localhost").searchParams.get("sessionId");
  } catch {
    return null;
  }
}

/** Normalize a single-valued HTTP header. */
export function requestHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/** Read and parse a JSON request body. */
export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf-8");
  return raw ? JSON.parse(raw) : undefined;
}

/** Write a JSON-RPC error response. */
export function writeJsonRpcError(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify({
    jsonrpc: "2.0",
    error: { code: -32000, message },
    id: null,
  }));
}

/** Write SSE proxy flush padding so intermediaries do not buffer the stream. */
export function writeSseProxyFlushPadding(res: ServerResponse): void {
  if (res.writableEnded) return;
  res.write(`: ${" ".repeat(2048)}\n\n`);
}
