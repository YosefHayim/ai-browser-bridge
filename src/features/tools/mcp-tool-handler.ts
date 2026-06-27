import type { McpServerOptions } from "./mcp-server-types.ts";
import { sanitizeToolArgs, toolActionStatus } from "./mcp-tool-utils.ts";
import { appendBridgeLog } from "../store/logging.ts";
import { runHooks } from "../user-config/hooks.ts";
import { evaluateToolPermission, permissionDecisionToToolResult } from "../domain/permissions.ts";
import type { ToolResult } from "../domain/types.ts";
import type { McpToolAction } from "./mcp-server-types.ts";

/** Inputs for executing one MCP tool call. */
export interface HandleToolCallParams {
  repoRoot: string;
  options: McpServerOptions;
  name: string;
  tool: { handler: (args: Record<string, unknown>) => Promise<ToolResult> };
  args: Record<string, unknown>;
}

/** Run hooks, permission checks, handler, logging, and return MCP content. */
export async function handleToolCall(params: HandleToolCallParams) {
  await runPreToolHooks(params.options);
  const result = await executeToolCall(params);
  await runPostToolHooks(params.options);
  return { content: [{ type: "text" as const, text: result.output }], isError: !result.ok };
}

async function executeToolCall(params: HandleToolCallParams): Promise<ToolResult> {
  await logToolCallStart(params);
  const denied = permissionDecisionToToolResult(
    evaluateToolPermission(params.name, params.options.getPermissionMode?.() ?? "auto"),
  );
  const result = await invokeToolHandler({ ...params, denied: denied ?? undefined });
  await logToolCallEnd({ params, result, blocked: denied !== undefined });
  return result;
}

/** Run PreToolUse hooks (best-effort). */
async function runPreToolHooks(options: McpServerOptions): Promise<void> {
  await runHooks("PreToolUse", options.hooks ?? []).catch(() => []);
}

/** Run PostToolUse hooks (best-effort). */
async function runPostToolHooks(options: McpServerOptions): Promise<void> {
  await runHooks("PostToolUse", options.hooks ?? []).catch(() => []);
}

/** Log and emit the tool-call start event. */
async function logToolCallStart(params: HandleToolCallParams): Promise<void> {
  const clean = sanitizeToolArgs(params.args);
  await appendBridgeLog({ repoPath: params.repoRoot, type: "mcp_tool_call", data: { name: params.name, args: clean } }).catch(() => {});
  await params.options.onToolAction?.({ name: params.name, status: "started", data: { args: clean } });
}

/** Inputs for invoking the tool handler after permission checks. */
interface InvokeToolHandlerParams extends HandleToolCallParams {
  denied?: ToolResult;
}

/** Invoke the tool handler or return a permission denial. */
async function invokeToolHandler(params: InvokeToolHandlerParams): Promise<ToolResult> {
  if (params.denied) return params.denied;
  try {
    return await params.tool.handler(buildHandlerArgs(params));
  } catch (error) {
    return { ok: false, output: error instanceof Error ? error.message : String(error), error: "tool-handler-error" };
  }
}

/** Build handler args with repo root and optional page injection. */
function buildHandlerArgs(params: InvokeToolHandlerParams): Record<string, unknown> {
  const page = params.options.getPage?.();
  return { ...params.args, _repoRoot: params.repoRoot, ...(page ? { _page: page } : {}) };
}

interface LogToolCallEndInput {
  params: HandleToolCallParams;
  result: ToolResult;
  blocked: boolean;
}

/** Log and emit the tool-call completion event. */
async function logToolCallEnd(input: LogToolCallEndInput): Promise<void> {
  await appendBridgeLog({
    repoPath: input.params.repoRoot,
    type: "mcp_tool_result",
    data: { name: input.params.name, ok: input.result.ok, outputBytes: input.result.output.length, error: input.result.error },
  }).catch(() => {});
  const status: McpToolAction["status"] = toolActionStatus(input.result, input.blocked);
  await input.params.options.onToolAction?.({
    name: input.params.name,
    status,
    data: { ok: input.result.ok, error: input.result.error, outputBytes: input.result.output.length },
  });
}
