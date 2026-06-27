import { BrowserManager } from "../providers/chrome/browser-manager.ts";
import { getBrowserProvider, normalizeProvider } from "../providers/create-provider.factory.ts";
import type { BridgeConfig } from "../domain/types.ts";
import type { Orchestrator } from "./orchestrator.ts";

/** Context for launching Chrome and wiring the orchestrator page. */
export interface ConnectBrowserContext {
  /** Browser automation coordinator. */
  orchestrator: Orchestrator;
  /** Public MCP connector URL, or empty when no tunnel. */
  connectorUrl: string;
  /** Effective bridge configuration. */
  config: BridgeConfig;
  /** Diagnostics log sink. */
  log: (line: string) => void;
}

/** Launch/attach Chrome, point the orchestrator at the page, and run connector setup. */
export async function connectBrowser(ctx: ConnectBrowserContext): Promise<BrowserManager | null> {
  const browser = await tryConnectBrowser(ctx);
  await ctx.orchestrator.start().catch(() => {});
  return browser;
}

/** Attempt browser launch and page wiring; return null on failure. */
async function tryConnectBrowser(ctx: ConnectBrowserContext): Promise<BrowserManager | null> {
  const providerId = normalizeProvider(ctx.config.provider);
  let browser: BrowserManager | null = new BrowserManager(ctx.config.repoPath, providerId);
  try {
    browser = await wireBrowserPage({ ...ctx, browser, provider: getBrowserProvider(providerId) });
  } catch (err) {
    browser = null;
    ctx.log(`Browser: failed to connect (${err instanceof Error ? err.message : String(err)}).`);
  }
  return browser;
}

/** Context for wiring a launched browser to the orchestrator. */
interface WireBrowserPageContext extends ConnectBrowserContext {
  /** Chrome manager instance. */
  browser: BrowserManager;
  /** Browser provider implementation. */
  provider: ReturnType<typeof getBrowserProvider>;
}

/** Launch browser, attach page, log connection mode, and run connector setup. */
async function wireBrowserPage(ctx: WireBrowserPageContext): Promise<BrowserManager> {
  const page = await ctx.browser.launch();
  ctx.orchestrator.setPage(page);
  logBrowserConnection(ctx);
  await maybeSetupConnector(ctx);
  return ctx.browser;
}

/** Log how the browser was connected. */
function logBrowserConnection(ctx: WireBrowserPageContext): void {
  if (ctx.browser.attachedViaCdp.value) {
    ctx.log("Browser: attached to Chrome on debug port (reusing your session).");
    return;
  }
  if (ctx.browser.spawnedNew.value) {
    ctx.log(`Browser: started isolated ${ctx.provider.displayName} profile.`);
    return;
  }
  ctx.log("Browser: connected.");
}

/** Run connector setup when a URL is available and the provider supports it. */
async function maybeSetupConnector(ctx: WireBrowserPageContext): Promise<void> {
  if (ctx.connectorUrl && ctx.provider.supportsMcpConnector) {
    const result = await ctx.orchestrator.openConnectorSetup({ connectorUrl: ctx.connectorUrl, automatic: true });
    ctx.log(`Connector setup: ${result.completed ? "ready" : "needs attention"}`);
    return;
  }
  if (!ctx.provider.supportsMcpConnector) {
    ctx.log(`Provider: ${ctx.provider.displayName} web has no MCP connector — @file mentions only.`);
  }
}
