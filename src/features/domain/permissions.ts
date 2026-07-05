import type { PermissionMode } from "./domainSchemas.ts";
import type { ToolResult } from "./types.ts";

export type { PermissionMode } from "./domainSchemas.ts";

export const PERMISSION_MODES = ["read-only", "ask", "auto"] as const;

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

/**
 * Normalize untrusted config input into a safe runtime permission mode.
 *
 * @param value - The raw config value to normalize.
 * @returns A valid PermissionMode, defaulting to "read-only".
 */
export function normalizePermissionMode(value: unknown): PermissionMode {
  return typeof value === "string" && isPermissionMode(value) ? value : "read-only";
}

/**
 * Type guard for PermissionMode values.
 *
 * @param value - The string to check.
 * @returns Whether the string is a valid PermissionMode.
 */
export function isPermissionMode(value: string): value is PermissionMode {
  return (PERMISSION_MODES as readonly string[]).includes(value);
}

/**
 * Classify an MCP tool into the access level needed to run it.
 *
 * @param toolName - The registered MCP tool name.
 * @returns The permission kind required by this tool.
 */
export function toolPermissionKind(toolName: string): ToolPermissionKind {
  if (READ_TOOLS.has(toolName)) return "read";
  if (WRITE_TOOLS.has(toolName)) return "write";
  if (TEST_TOOLS.has(toolName)) return "test";
  return "process";
}

/**
 * Evaluate whether the current permission mode allows a tool call.
 *
 * @param toolName - The registered MCP tool name.
 * @param modeInput - The raw permission mode value (will be normalized).
 * @returns A decision object describing whether the tool is allowed.
 */
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

/**
 * Convert a denied decision into the ToolResult shape used by MCP handlers.
 *
 * @param decision - The permission decision to convert.
 * @returns A ToolResult if denied, or undefined if allowed.
 */
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
