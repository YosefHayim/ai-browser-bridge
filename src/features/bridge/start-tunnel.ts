import { CloudflareTunnel } from "../tunnel/cloudflare.ts";
import { sessionsDir } from "../store/paths.ts";
import { updateSession } from "../store/session-store.ts";
import type { BridgeConfig } from "../domain/types.ts";
import { mcpConnectorUrl } from "./mcp-connector-url.ts";

/** Result of attempting to start the Cloudflare tunnel. */
export interface StartTunnelResult {
  /** Running tunnel instance, or null on failure. */
  tunnel: CloudflareTunnel | null;
  /** Public connector URL or empty string. */
  connectorUrl: string;
}

/** Context for starting the Cloudflare tunnel. */
export interface StartTunnelContext {
  /** Effective bridge configuration. */
  config: BridgeConfig;
  /** Active session id to persist the tunnel URL into. */
  sessionId: string;
  /** Diagnostics log sink. */
  log: (line: string) => void;
}

/** Start the Cloudflare tunnel and sync the connector URL into config + session. */
export async function startTunnel(ctx: StartTunnelContext): Promise<StartTunnelResult> {
  try {
    return await startTunnelSuccess(ctx);
  } catch {
    ctx.log("Tunnel: failed to start (cloudflared not installed?). MCP tools require a public URL ChatGPT can reach.");
    return { tunnel: null, connectorUrl: "" };
  }
}

/** Start tunnel and persist URL on success. */
async function startTunnelSuccess(ctx: StartTunnelContext): Promise<StartTunnelResult> {
  const tunnel = new CloudflareTunnel();
  const tunnelUrl = await tunnel.start(ctx.config.mcpPort);
  return finalizeTunnelStart({ ctx, tunnel, tunnelUrl });
}

/** Persist tunnel URL, log readiness, and return the start result. */
async function finalizeTunnelStart(input: {
  ctx: StartTunnelContext;
  tunnel: CloudflareTunnel;
  tunnelUrl: string;
}): Promise<StartTunnelResult> {
  input.ctx.config.tunnelUrl = input.tunnelUrl;
  const connectorUrl = mcpConnectorUrl(input.tunnelUrl);
  await persistTunnelUrl({ ctx: input.ctx, tunnelUrl: input.tunnelUrl });
  logTunnelReady({ ctx: input.ctx, tunnelUrl: input.tunnelUrl, connectorUrl });
  return { tunnel: input.tunnel, connectorUrl };
}

/** Context for persisting a tunnel URL to session metadata. */
interface PersistTunnelUrlContext {
  /** Tunnel start context. */
  ctx: StartTunnelContext;
  /** Public tunnel URL. */
  tunnelUrl: string;
}

/** Persist tunnel URL to session metadata. */
async function persistTunnelUrl(input: PersistTunnelUrlContext): Promise<void> {
  await updateSession(input.ctx.sessionId, { tunnelUrl: input.tunnelUrl }, { baseDir: sessionsDir(input.ctx.config.repoPath) }).catch(() => {});
}

/** Context for logging tunnel readiness. */
interface LogTunnelReadyContext {
  /** Tunnel start context. */
  ctx: StartTunnelContext;
  /** Public tunnel URL. */
  tunnelUrl: string;
  /** MCP connector URL. */
  connectorUrl: string;
}

/** Log tunnel and connector URLs. */
function logTunnelReady(input: LogTunnelReadyContext): void {
  input.ctx.log(`Tunnel:  ${input.tunnelUrl}`);
  input.ctx.log(`Connector: ${input.connectorUrl}`);
}

export { mcpConnectorUrl };
