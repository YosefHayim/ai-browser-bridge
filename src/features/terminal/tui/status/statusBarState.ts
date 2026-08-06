import type { ContextCounter } from "@/features/bridge";
import type { AppProps } from "../shell/appTypes.ts";
import type { StatusBarProps } from "./StatusBar.tsx";

/** Resolved display values for the status bar. */
type StatusBarDisplay = {
  displayPermissionMode: string;
  displayToolCallCount: number;
  displayBranch?: string;
  displaySessionId?: string;
};

/** Builds status bar display props from app props and runtime status. */
export const statusBarProps = (options: {
  props: AppProps;
  status: string;
  counter: ContextCounter;
}): StatusBarProps => {
  const { props, status, counter } = options;
  const ctxPct = counter.fraction * 100;
  const display = statusBarDisplay(props);
  return {
    shortStatus: truncateText({ value: status, maxLength: 14 }),
    ctxColor: contextColor(ctxPct),
    ctxPctLabel: `${ctxPct.toFixed(0)}%`,
    shortModel: truncateText({ value: counter.modelLabel, maxLength: 10 }),
    displayPermissionMode: display.displayPermissionMode,
    displayToolCallCount: display.displayToolCallCount,
    shortBranch: display.displayBranch
      ? truncateText({ value: display.displayBranch, maxLength: 8 })
      : "nogit",
    displaySessionId: display.displaySessionId ? display.displaySessionId.slice(0, 8) : "nosess",
  };
};

const contextColor = (ctxPct: number): string => {
  if (ctxPct > 80) return "red";
  if (ctxPct > 50) return "yellow";
  return "green";
};

/** Resolve permission, tool, branch, and session labels for the status bar. */
const statusBarDisplay = (props: AppProps): StatusBarDisplay => {
  return {
    displayPermissionMode: permissionModeLabel(props),
    displayToolCallCount: toolCallCountLabel(props),
    displayBranch: branchLabel(props),
    displaySessionId: sessionIdLabel(props),
  };
};

const permissionModeLabel = (props: AppProps): string => {
  const liveMode = props.permission?.getMode();
  if (liveMode !== undefined) return liveMode;
  if (props.permissionMode !== undefined) return props.permissionMode;
  if (props.config.permissionMode !== undefined) return props.config.permissionMode;
  return "auto";
};

const toolCallCountLabel = (props: AppProps): number => {
  const liveCount = props.statusline?.toolCallCount();
  if (liveCount !== undefined) return liveCount;
  if (props.toolCallCount !== undefined) return props.toolCallCount;
  return 0;
};

const branchLabel = (props: AppProps): string | undefined => {
  if (props.statusline?.branch !== undefined) return props.statusline.branch;
  return props.branch;
};

const sessionIdLabel = (props: AppProps): string | undefined => {
  const liveSessionId = props.session?.getId();
  if (liveSessionId !== undefined) return liveSessionId;
  return props.sessionId;
};

const truncateText = (input: { value: string; maxLength: number }): string => {
  if (input.value.length <= input.maxLength) return input.value;
  return `${input.value.slice(0, input.maxLength - 1)}…`;
};
