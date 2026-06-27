import type { McpToolAction } from "../tools/server.ts";
import type { PermissionMode } from "../domain/permissions.ts";
import { loadHooksConfig } from "../user-config/hooks.ts";
import { appendSessionEvent } from "../store/session-store.ts";
import { sessionsDir } from "../store/paths.ts";
import type { BridgeConfig } from "../domain/types.ts";
import type { EngineFeatureFlags } from "./engine-boot.runtime.ts";
import { startMcpIfNeeded } from "./engine-boot.runtime.ts";
import type { EngineRuntimeState } from "./engine.options.types.ts";

/** Context for recording MCP tool actions to the session log. */
export interface RecordToolActionContext {
  toolActions: McpToolAction[];
  getSessionId: () => string;
  sessionStore: { baseDir: string };
  action: McpToolAction;
}

/** Append one tool action to memory and the session event log. */
export async function recordToolAction(ctx: RecordToolActionContext): Promise<void> {
  ctx.toolActions.push(ctx.action);
  await appendSessionEvent(ctx.getSessionId(), {
    type: "action",
    name: ctx.action.name,
    status: ctx.action.status,
    content: ctx.action.data?.error ? String(ctx.action.data.error) : undefined,
    data: ctx.action.data,
  }, ctx.sessionStore).catch(() => {});
}

/** Context for optionally starting the MCP server. */
export interface MaybeStartMcpContext {
  config: BridgeConfig;
  flags: EngineFeatureFlags;
  hooksConfig: Awaited<ReturnType<typeof loadHooksConfig>>;
  runtime: EngineRuntimeState;
  toolActions: McpToolAction[];
  log: (line: string) => void;
}

/** Start MCP server when tools are enabled; otherwise return null. */
export async function maybeStartMcp(ctx: MaybeStartMcpContext) {
  if (!ctx.flags.withTools) return null;
  const mcpServer = await startMcpForBoot(ctx);
  ctx.log(`MCP:     ${mcpServer.url}`);
  return mcpServer;
}

/** Start MCP server and wire tool action recording for one boot. */
async function startMcpForBoot(ctx: MaybeStartMcpContext) {
  const sessionStore = { baseDir: sessionsDir(ctx.config.repoPath) };
  const getSessionId = () => ctx.runtime.sessionId;
  return startMcpIfNeeded({
    config: ctx.config,
    getPermissionMode: () => ctx.runtime.permissionMode,
    hooks: ctx.hooksConfig.hooks,
    onToolAction: (action) => recordToolAction({ toolActions: ctx.toolActions, getSessionId, sessionStore, action }),
  });
}

export type { StartMcpServerContext } from "./engine-boot.runtime.ts";