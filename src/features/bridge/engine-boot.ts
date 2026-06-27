import { Orchestrator } from "./orchestrator.ts";
import { ContextCounter } from "./context-counter.ts";
import type { StartEngineOptions, BuildEngineContext } from "./engine.types.ts";
import { attachPersistenceListener } from "./attach-persistence-listener.ts";
import { startTunnel } from "./start-tunnel.ts";
import { connectBrowser } from "./connect-browser.ts";
import { loadEngineBootState, type EngineBootState } from "./engine-boot.load.ts";

/** Boot all engine subsystems and return build context. */
export async function bootEngine(options: StartEngineOptions): Promise<BuildEngineContext> {
  const boot = await loadEngineBootState(options);
  return wireEngineRuntime(boot);
}

/** Wire orchestrator, tunnel, browser, and return build context. */
async function wireEngineRuntime(boot: EngineBootState): Promise<BuildEngineContext> {
  const core = createEngineCore(boot);
  const tunnel = await startTunnelIfNeeded(boot);
  const browser = await connectBrowserIfNeeded({ boot, orchestrator: core.orchestrator, connectorUrl: tunnel.connectorUrl });
  return assembleBuildContext({ boot, ...core, tunnel, browser });
}

/** Create orchestrator, counter, and persistence wiring. */
function createEngineCore(boot: EngineBootState) {
  const orchestrator = new Orchestrator(boot.config);
  const counter = new ContextCounter(boot.config.contextLimit, boot.config.model);
  attachPersistenceListener({ orchestrator, counter, config: boot.config, getSessionId: boot.getSessionId });
  return { orchestrator, counter };
}

/** Start tunnel when enabled for this boot. */
async function startTunnelIfNeeded(boot: EngineBootState) {
  if (!boot.flags.withTunnel) return { tunnel: null, connectorUrl: "" };
  return startTunnel({ config: boot.config, sessionId: boot.runtime.sessionId, log: boot.log });
}

/** Context for optional browser connection during boot. */
interface ConnectBrowserIfNeededContext {
  boot: EngineBootState;
  orchestrator: Orchestrator;
  connectorUrl: string;
}

/** Connect browser when enabled for this boot. */
async function connectBrowserIfNeeded(ctx: ConnectBrowserIfNeededContext) {
  if (ctx.boot.flags.withBrowser === false) return null;
  return connectBrowser({ orchestrator: ctx.orchestrator, connectorUrl: ctx.connectorUrl, config: ctx.boot.config, log: ctx.boot.log });
}

/** Context for assembling the final build context. */
interface AssembleBuildContextInput {
  boot: EngineBootState;
  orchestrator: Orchestrator;
  counter: ContextCounter;
  tunnel: Awaited<ReturnType<typeof startTunnelIfNeeded>>;
  browser: Awaited<ReturnType<typeof connectBrowserIfNeeded>>;
}

/** Assemble the final {@link BuildEngineContext}. */
function assembleBuildContext(input: AssembleBuildContextInput): BuildEngineContext {
  return {
    config: input.boot.config,
    orchestrator: input.orchestrator,
    counter: input.counter,
    browser: input.browser,
    mcpServer: input.boot.mcpServer,
    tunnel: input.tunnel.tunnel,
    connectorUrl: input.tunnel.connectorUrl,
    hooksConfig: input.boot.hooksConfig,
    toolActions: input.boot.toolActions,
    branch: input.boot.runtime.branch,
    runtime: { sessionId: input.boot.runtime.sessionId, permissionMode: input.boot.runtime.permissionMode },
  };
}
