import { saveConfig } from "./load-config.ts";
import { runHooks } from "../user-config/hooks.ts";
import { normalizePermissionMode, type PermissionMode } from "../domain/permissions.ts";
import { resolveFileMentions } from "../store/file-resolver.ts";
import type { BridgeConfig, Message } from "../domain/types.ts";
import type { BuildEngineContext, Engine, EngineRuntimeState } from "./engine.types.ts";
import type { AskEngineInput, ShutdownEngineInput } from "./build-engine.types.ts";

/** Build the {@link Engine} object returned by {@link startEngine}. */
export function buildEngine(ctx: BuildEngineContext): Engine {
  return {
    config: ctx.config,
    orchestrator: ctx.orchestrator,
    counter: ctx.counter,
    browser: ctx.browser,
    mcpServer: ctx.mcpServer,
    tunnel: ctx.tunnel,
    connectorUrl: ctx.connectorUrl,
    hooksConfig: ctx.hooksConfig,
    toolActions: ctx.toolActions,
    branch: ctx.branch,
    getSessionId: () => ctx.runtime.sessionId,
    setSessionId: (id) => {
      ctx.runtime.sessionId = id;
    },
    getPermissionMode: () => ctx.runtime.permissionMode,
    setPermissionMode: (mode) => setPermissionMode({ config: ctx.config, runtime: ctx.runtime, mode }),
    ask: (input) => askEngine({ ctx, input }),
    abort: () => abortEngine(ctx),
    shutdown: (input) => shutdownEngine({ ctx, closeBrowser: input?.closeBrowser ?? false }),
  };
}

/** Context for updating permission mode. */
interface SetPermissionModeContext {
  /** Effective bridge configuration. */
  config: BridgeConfig;
  /** Mutable runtime state. */
  runtime: EngineRuntimeState;
  /** New permission mode. */
  mode: PermissionMode;
}

/** Update permission mode in runtime state and persist to config. */
function setPermissionMode(ctx: SetPermissionModeContext): void {
  ctx.runtime.permissionMode = normalizePermissionMode(ctx.mode);
  ctx.config.permissionMode = ctx.runtime.permissionMode;
  saveConfig(ctx.config).catch(() => {});
}

/** Context for the engine ask method. */
interface AskEngineCallContext {
  /** Engine build context. */
  ctx: BuildEngineContext;
  /** Ask input from the caller. */
  input: AskEngineInput;
}

/** Resolve file mentions, run hooks, and send the prompt. */
async function askEngine(call: AskEngineCallContext): Promise<Message | null> {
  await runHooks("UserPromptSubmit", call.ctx.hooksConfig.hooks).catch(() => []);
  const resolved = await resolveFileMentions(call.input.content, call.ctx.config.repoPath);
  return call.ctx.orchestrator.sendPrompt({ content: resolved.prompt, timeoutMs: call.input.timeoutMs });
}

/** Best-effort stop of an in-flight response. */
async function abortEngine(ctx: BuildEngineContext): Promise<void> {
  await ctx.orchestrator.stopResponse().catch(() => {});
}

/** Context for engine shutdown. */
interface ShutdownEngineCallContext {
  /** Engine build context. */
  ctx: BuildEngineContext;
  /** Whether to close the browser. */
  closeBrowser: boolean;
}

/** Run SessionEnd hooks and stop tunnel, MCP server, and optionally Chrome. */
async function shutdownEngine(call: ShutdownEngineCallContext): Promise<void> {
  await runHooks("SessionEnd", call.ctx.hooksConfig.hooks).catch(() => []);
  call.ctx.tunnel?.stop();
  call.ctx.mcpServer?.close();
  if (call.closeBrowser) await call.ctx.browser?.close().catch(() => {});
}

export type { AskEngineInput, ShutdownEngineInput } from "./build-engine.types.ts";
