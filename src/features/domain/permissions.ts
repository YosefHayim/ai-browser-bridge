import { Schema } from "effect";
import type { ToolResult } from "./types.ts";

export const PERMISSION_MODES = ["read-only", "ask", "auto"] as const;

const READ_TOOLS = new Set(["grep_code", "read_file", "git_diff"]);
const WRITE_TOOLS = new Set(["apply_patch"]);
const TEST_TOOLS = new Set(["run_tests"]);

export type PermissionMode = (typeof PERMISSION_MODES)[number];

/** Effect Schema for MCP tool access modes — derived from {@link PERMISSION_MODES}. */
export const PermissionModeSchema = Schema.Literal(...PERMISSION_MODES);

export type ToolPermissionKind = "read" | "write" | "test" | "process";
export type PermissionDecisionStatus = "allowed" | "blocked" | "needs-confirmation";

export type ToolPermissionDecision = {
  readonly toolName: string;
  readonly mode: PermissionMode;
  readonly kind: ToolPermissionKind;
  readonly status: PermissionDecisionStatus;
  readonly reason: string;
  readonly message: string;
};

/** Normalize untrusted config input into a safe runtime permission mode. */
export const normalizePermissionMode = (value: unknown): PermissionMode => {
  if (typeof value !== "string") return "read-only";
  if (!isPermissionMode(value)) return "read-only";
  return value;
};

export const isPermissionMode = (value: string): value is PermissionMode => {
  for (const mode of PERMISSION_MODES) {
    if (mode === value) return true;
  }
  return false;
};

/** Classify an MCP tool into the access level needed to run it. */
export const toolPermissionKind = (toolName: string): ToolPermissionKind => {
  if (READ_TOOLS.has(toolName)) return "read";
  if (WRITE_TOOLS.has(toolName)) return "write";
  if (TEST_TOOLS.has(toolName)) return "test";
  return "process";
};

/** Evaluate whether the current permission mode allows a tool call. */
export const evaluateToolPermission = (
  toolName: string,
  modeInput: unknown,
): ToolPermissionDecision => {
  const mode = normalizePermissionMode(modeInput);
  const kind = toolPermissionKind(toolName);

  if (kind === "read" || mode === "auto") {
    return {
      toolName,
      mode,
      kind,
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
      status: "needs-confirmation",
      reason: "interactive-confirmation-unavailable",
      message: `Tool ${toolName} requires ${kind} access, but permission mode ask cannot continue because interactive confirmation is not implemented yet.`,
    };
  }

  return {
    toolName,
    mode,
    kind,
    status: "blocked",
    reason: "permission-mode-read-only",
    message: `Tool ${toolName} requires ${kind} access, but permission mode read-only only allows read tools.`,
  };
};

/** Convert a denied decision into the ToolResult shape used by MCP handlers. */
export const permissionDecisionToToolResult = (
  decision: ToolPermissionDecision,
): ToolResult | undefined => {
  if (decision.status === "allowed") return undefined;
  return {
    ok: false,
    output: decision.message,
    error: decision.reason,
  };
};
