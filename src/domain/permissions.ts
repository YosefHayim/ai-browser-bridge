import type { ToolReport } from "@/domain/message-types.ts";

export const PERMISSION_MODES = ["read-only", "ask", "auto"] as const;

const READ_TOOLS = new Set(["grep_code", "read_file", "git_diff"]);
const WRITE_TOOLS = new Set(["apply_patch"]);
const TEST_TOOLS = new Set(["run_tests"]);

export type PermissionMode = (typeof PERMISSION_MODES)[number];

export type ToolPermissionKind = "read" | "write" | "test" | "process";
type PermissionDecisionStatus = "allowed" | "blocked" | "needs-confirmation";

export type ToolPermissionDecision = {
  readonly toolName: string;
  readonly mode: PermissionMode;
  readonly kind: ToolPermissionKind;
  readonly status: PermissionDecisionStatus;
  readonly reason: string;
  readonly message: string;
};

export const cleanPermissionMode = (modeArgument: unknown): PermissionMode => {
  const isModeTypeNotString = typeof modeArgument !== "string";
  if (isModeTypeNotString) return "read-only";

  const isUnknownPermissionMode = !isPermissionMode(modeArgument);
  if (isUnknownPermissionMode) return "read-only";

  return modeArgument;
};

const isPermissionMode = (modeCandidate: string): modeCandidate is PermissionMode => {
  for (const mode of PERMISSION_MODES) {
    const isSameMode = mode === modeCandidate;
    if (isSameMode) return true;
  }
  return false;
};

export const readToolPermissionKind = (toolName: string): ToolPermissionKind => {
  const isReadTool = READ_TOOLS.has(toolName);
  if (isReadTool) return "read";

  const isWriteTool = WRITE_TOOLS.has(toolName);
  if (isWriteTool) return "write";

  const isTestTool = TEST_TOOLS.has(toolName);
  if (isTestTool) return "test";

  return "process";
};

export const evaluateToolPermission = (
  toolName: string,
  modeArgument: unknown,
): ToolPermissionDecision => {
  const mode = cleanPermissionMode(modeArgument);

  const kind = readToolPermissionKind(toolName);

  const isApprovalSkipped = kind === "read" || mode === "auto";
  if (isApprovalSkipped) {
    return {
      toolName,
      mode,
      kind,
      status: "allowed",
      reason: "allowed",
      message: `Tool ${toolName} is allowed in ${mode} mode.`,
    };
  }

  const isModeAsk = mode === "ask";
  if (isModeAsk) {
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

export const convertPermissionDecisionToToolReport = (
  decision: ToolPermissionDecision,
): ToolReport | null => {
  const isDecisionStatusAllowed = decision.status === "allowed";
  if (isDecisionStatusAllowed) return null;

  return {
    ok: false,
    output: decision.message,
    error: decision.reason,
  };
};
