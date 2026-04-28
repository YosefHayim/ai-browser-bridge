import type { ToolResult } from "../types/types.ts";

export const PERMISSION_MODES = ["read-only", "ask", "auto"] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

export type ToolPermissionKind = "read" | "write" | "test" | "process";
export type PermissionDecisionStatus = "allowed" | "blocked" | "needs-confirmation";

export interface ToolPermissionDecision {
  toolName: string;
  mode: PermissionMode;
  kind: ToolPermissionKind;
  allowed: boolean;
  status: PermissionDecisionStatus;
  reason: string;
  message: string;
}

const READ_TOOLS = new Set(["grep_code", "read_file", "git_diff"]);
const WRITE_TOOLS = new Set(["apply_patch"]);
const TEST_TOOLS = new Set(["run_tests"]);

/** Normalize untrusted config input into a safe runtime permission mode. */
export function normalizePermissionMode(value: unknown): PermissionMode {
  return typeof value === "string" && isPermissionMode(value) ? value : "read-only";
}

export function isPermissionMode(value: string): value is PermissionMode {
  return (PERMISSION_MODES as readonly string[]).includes(value);
}

/** Classify an MCP tool into the access level needed to run it. */
export function toolPermissionKind(toolName: string): ToolPermissionKind {
  if (READ_TOOLS.has(toolName)) return "read";
  if (WRITE_TOOLS.has(toolName)) return "write";
  if (TEST_TOOLS.has(toolName)) return "test";
  return "process";
}

/** Evaluate whether the current permission mode allows a tool call. */
export function evaluateToolPermission(
  toolName: string,
  modeInput: unknown,
): ToolPermissionDecision {
  const mode = normalizePermissionMode(modeInput);
  const kind = toolPermissionKind(toolName);

  if (kind === "read" || mode === "auto") {
    return {
      toolName,
      mode,
      kind,
      allowed: true,
      status: "allowed",
      reason: "allowed",
      message: `Tool ${toolName} is allowed in ${mode} mode.`,
    };
  }

  if (mode === "ask") {
    return {
      toolName,
      mode,
      kind,
      allowed: false,
      status: "needs-confirmation",
      reason: "interactive-confirmation-unavailable",
      message: `Tool ${toolName} requires ${kind} access, but permission mode ask cannot continue because interactive confirmation is not implemented yet.`,
    };
  }

  return {
    toolName,
    mode,
    kind,
    allowed: false,
    status: "blocked",
    reason: "permission-mode-read-only",
    message: `Tool ${toolName} requires ${kind} access, but permission mode read-only only allows read tools.`,
  };
}

/** Convert a denied decision into the ToolResult shape used by MCP handlers. */
export function permissionDecisionToToolResult(
  decision: ToolPermissionDecision,
): ToolResult | undefined {
  if (decision.allowed) return undefined;
  return {
    ok: false,
    output: decision.message,
    error: decision.reason,
  };
}
