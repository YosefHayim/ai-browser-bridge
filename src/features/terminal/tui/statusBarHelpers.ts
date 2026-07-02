import type { ContextCounter } from "../../bridge/createEngineFactory.ts";
import type { StatusBarProps } from "./StatusBar.tsx";
import type { AppProps } from "./appTypes.ts";

/** Resolved display values for the status bar. */
interface StatusBarDisplay {
  displayPermissionMode: string;
  displayToolCallCount: number;
  displayBranch?: string;
  displaySessionId?: string;
}

/** Builds status bar display props from app props and runtime status. */
export function buildStatusBarProps(options: {
  props: AppProps;
  status: string;
  counter: ContextCounter;
}): StatusBarProps {
  const { props, status, counter } = options;
  const ctxPct = counter.fraction * 100;
  const display = resolveStatusBarDisplay(props);
  return {
    shortStatus: truncateText({ value: status, maxLength: 14 }),
    ctxColor: ctxPct > 80 ? "red" : ctxPct > 50 ? "yellow" : "green",
    ctxPctLabel: `${ctxPct.toFixed(0)}%`,
    shortModel: truncateText({ value: counter.modelLabel, maxLength: 10 }),
    displayPermissionMode: display.displayPermissionMode,
    displayToolCallCount: display.displayToolCallCount,
    shortBranch: display.displayBranch
      ? truncateText({ value: display.displayBranch, maxLength: 8 })
      : "nogit",
    displaySessionId: display.displaySessionId ? display.displaySessionId.slice(0, 8) : "nosess",
  };
}

/** Resolve permission, tool, branch, and session labels for the status bar. */
function resolveStatusBarDisplay(props: AppProps): StatusBarDisplay {
  return {
    displayPermissionMode:
      props.permission?.getMode() ?? props.permissionMode ?? props.config.permissionMode ?? "auto",
    displayToolCallCount: props.statusline?.toolCallCount() ?? props.toolCallCount ?? 0,
    displayBranch: props.statusline?.branch ?? props.branch,
    displaySessionId: props.session?.getId() ?? props.sessionId,
  };
}

function truncateText(input: { value: string; maxLength: number }): string {
  if (input.value.length <= input.maxLength) return input.value;
  return `${input.value.slice(0, input.maxLength - 1)}…`;
}
