import { startMcpServer, type McpToolAction } from "../tools/server.ts";
import { normalizePermissionMode, type PermissionMode } from "../domain/permissions.ts";
import { loadHooksConfig, runHooks } from "../user-config/hooks.ts";
import { appendSessionEvent, createSession } from "../store/session-store.ts";
import { sessionsDir } from "../store/paths.ts";
import type { StartEngineOptions, EngineRuntimeState } from "./engine.options.types.ts";
import type { BridgeConfig } from "../domain/types.ts";
import { currentGitBranch } from "./engine-config.helpers.ts";

/** Resolved feature flags for one engine start. */
export interface EngineFeatureFlags {
  withTools: boolean;
  withTunnel: boolean;
  withBrowser: boolean | undefined;
}

/** Context for resolving engine feature flags. */
export interface ResolveEngineFlagsContext {
  options: StartEngineOptions;
  supportsMcpConnector: boolean;
}

/** Resolve tool/tunnel/browser flags from options and provider capabilities. */
export function resolveEngineFlags(ctx: ResolveEngineFlagsContext): EngineFeatureFlags {
  const withTools = (ctx.options.withTools ?? true) && ctx.supportsMcpConnector;
  const withTunnel = (ctx.options.withTunnel ?? withTools) && ctx.supportsMcpConnector;
  return { withTools, withTunnel, withBrowser: ctx.options.withBrowser };
}

/** Context for initializing runtime session state. */
export interface InitEngineRuntimeContext {
  config: BridgeConfig;
  hooksConfig: Awaited<ReturnType<typeof loadHooksConfig>>;
}

/** Create a fresh session and run SessionStart hooks. */
export async function initEngineRuntime(ctx: InitEngineRuntimeContext): Promise<EngineRuntimeState & { branch?: string }> {
  const sessionStore = { baseDir: sessionsDir(ctx.config.repoPath) };
  const branch = await currentGitBranch(ctx.config.repoPath);
  const session = await createSession({
    repoPath: ctx.config.repoPath,
    model: ctx.config.model ?? null,
    contextLimit: ctx.config.contextLimit,
    tunnelUrl: ctx.config.tunnelUrl ?? null,
  }, sessionStore);
  await runHooks("SessionStart", ctx.hooksConfig.hooks).catch(() => []);
  return { sessionId: session.metadata.id, permissionMode: normalizePermissionMode(ctx.config.permissionMode ?? "auto"), branch };
}

/** Context for starting the MCP server during engine boot. */
export interface StartMcpServerContext {
  config: BridgeConfig;
  getPermissionMode: () => PermissionMode;
  hooks: Awaited<ReturnType<typeof loadHooksConfig>>["hooks"];
  onToolAction: (action: McpToolAction) => Promise<void>;
}

/** Start the MCP server when tools are enabled for this provider. */
export async function startMcpIfNeeded(ctx: StartMcpServerContext) {
  return startMcpServer(ctx.config.repoPath, ctx.config.mcpPort, {
    getPermissionMode: ctx.getPermissionMode,
    hooks: ctx.hooks,
    onToolAction: ctx.onToolAction,
  });
}
