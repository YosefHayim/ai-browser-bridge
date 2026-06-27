import { getBrowserProvider } from "../providers/create-provider.factory.ts";
import type { McpToolAction } from "../tools/server.ts";
import { loadHooksConfig } from "../user-config/hooks.ts";
import type { StartEngineOptions } from "./engine.types.ts";
import { resolveEngineConfig } from "./resolve-engine-config.ts";
import { resolveEngineLog, logHookWarnings } from "./engine-config.helpers.ts";
import { initEngineRuntime, resolveEngineFlags } from "./engine-boot.runtime.ts";
import { maybeStartMcp } from "./engine-boot.mcp.ts";

/** Loaded boot state before orchestrator wiring. */
export interface EngineBootState {
  config: Awaited<ReturnType<typeof resolveEngineConfig>>;
  hooksConfig: Awaited<ReturnType<typeof loadHooksConfig>>;
  runtime: Awaited<ReturnType<typeof initEngineRuntime>>;
  flags: ReturnType<typeof resolveEngineFlags>;
  toolActions: McpToolAction[];
  mcpServer: Awaited<ReturnType<typeof maybeStartMcp>>;
  log: (line: string) => void;
  getSessionId: () => string;
}

/** Load config, hooks, and runtime flags for engine boot. */
async function loadEngineBootConfig(options: StartEngineOptions) {
  const log = resolveEngineLog(options);
  const config = await resolveEngineConfig(options);
  const hooksConfig = await loadHooksConfig({ repoRoot: config.repoPath });
  return finalizeBootConfigLoad({ options, log, config, hooksConfig });
}

/** Resolve engine flags and log hook warnings. */
function finalizeBootConfigLoad(input: {
  options: StartEngineOptions;
  log: ReturnType<typeof resolveEngineLog>;
  config: Awaited<ReturnType<typeof resolveEngineConfig>>;
  hooksConfig: Awaited<ReturnType<typeof loadHooksConfig>>;
}) {
  const flags = resolveEngineFlags({
    options: input.options,
    supportsMcpConnector: getBrowserProvider(input.config.provider).supportsMcpConnector,
  });
  logHookWarnings({ errors: input.hooksConfig.errors, log: input.log });
  return { log: input.log, config: input.config, hooksConfig: input.hooksConfig, flags };
}

/** Load config, hooks, session, and optional MCP server. */
export async function loadEngineBootState(options: StartEngineOptions): Promise<EngineBootState> {
  const bootConfig = await loadEngineBootConfig(options);
  const runtime = await initEngineRuntime({ config: bootConfig.config, hooksConfig: bootConfig.hooksConfig });
  const mcpServer = await startBootMcp({ bootConfig, runtime });
  return { ...bootConfig, runtime, toolActions: mcpServer.toolActions, mcpServer: mcpServer.server, getSessionId: () => runtime.sessionId };
}

/** Start optional MCP server during boot. */
async function startBootMcp(input: {
  bootConfig: Awaited<ReturnType<typeof loadEngineBootConfig>>;
  runtime: Awaited<ReturnType<typeof initEngineRuntime>>;
}) {
  const toolActions: McpToolAction[] = [];
  const server = await maybeStartMcp({
    config: input.bootConfig.config,
    flags: input.bootConfig.flags,
    hooksConfig: input.bootConfig.hooksConfig,
    runtime: input.runtime,
    toolActions,
    log: input.bootConfig.log,
  });
  return { toolActions, server };
}
