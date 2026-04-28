/** Check whether the tunnel URL is reachable. */
export async function checkTunnelHealth(url: string): Promise<boolean> {
  try {
    const res = await fetch(mcpConnectorUrl(url), { method: "GET", signal: AbortSignal.timeout(5_000) });
    return res.ok || res.status === 200;
  } catch {
    return false;
  }
}

function mcpConnectorUrl(url: string): string {
  const normalized = url.replace(/\/+$/, "");
  return normalized.endsWith("/mcp") || normalized.endsWith("/sse") ? normalized : `${normalized}/mcp`;
}
