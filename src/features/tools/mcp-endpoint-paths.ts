/** Whether the pathname is an SSE MCP endpoint. */
export function isSseEndpointPath(pathname: string): boolean {
  return pathname === "/" || pathname === "/sse" || pathname === "/sse/";
}

/** Whether the pathname is a streamable HTTP MCP endpoint. */
export function isStreamableHttpEndpointPath(pathname: string): boolean {
  return pathname === "/mcp" || pathname === "/mcp/";
}
