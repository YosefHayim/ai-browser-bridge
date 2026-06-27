/** Build `<tunnelUrl>/mcp`, the URL ChatGPT's connector points at. */
export function mcpConnectorUrl(tunnelUrl: string): string {
  return `${tunnelUrl.replace(/\/+$/, "")}/mcp`;
}
