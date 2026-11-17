import type { TokenCounter } from "@/orchestrator/context-counter.ts";
import type { AppProps } from "@/terminal/tui/shell/app-types.ts";
import type { StatusBarProps } from "@/terminal/tui/status/status-bar.tsx";

const NO_SESSION_LABEL = "nosess";

const NO_GIT_BRANCH_LABEL = "nogit";

export function readStatusBarProps(details: {
  props: AppProps;
  status: string;
  counter: TokenCounter;
}): StatusBarProps {
  const { props, status, counter } = details;
  const percentPerFraction = 100;

  const windowPercent = counter.fraction * percentPerFraction;
  const branch = readBranchLabel(props);
  const sessionId = readSessionIdLabel(props);

  const shortModelMaxLength = 10;

  const shortStatusMaxLength = 14;

  return {
    shortStatus: truncateString({ text: status, maxLength: shortStatusMaxLength }),
    ctxColor: readWindowColor(windowPercent),
    ctxPctLabel: `${windowPercent.toFixed(0)}%`,
    shortModel: truncateString({ text: counter.modelLabel, maxLength: shortModelMaxLength }),
    displayPermissionMode: readPermissionModeLabel(props),
    displayToolCallCount: readToolCallCount(props),
    shortBranch: readShortBranchLabel(branch),
    displaySessionId: readShortSessionIdLabel(sessionId),
  };
}

function readWindowColor(windowPercent: number): string {
  const almostFullWindowPercent = 80;

  const isWindowAlmostFull = windowPercent > almostFullWindowPercent;
  if (isWindowAlmostFull) return "red";

  const halfFullWindowPercent = 50;

  const isWindowHalfFull = windowPercent > halfFullWindowPercent;
  if (isWindowHalfFull) return "yellow";

  return "green";
}

function readPermissionModeLabel(props: AppProps): string {
  const liveMode = props.permission?.getMode();

  const hasLiveMode = liveMode != null;
  if (hasLiveMode) return liveMode;

  const propsPermissionMode = props.permissionMode;

  const hasPropsPermissionMode = propsPermissionMode != null;
  if (hasPropsPermissionMode) return propsPermissionMode;

  const settingsPermissionMode = props.config.permissionMode;

  const hasSettingsPermissionMode = settingsPermissionMode != null;
  if (hasSettingsPermissionMode) return settingsPermissionMode;

  return "auto";
}

function readToolCallCount(props: AppProps): number {
  const liveCount = props.statusline?.toolCallCount();

  const hasLiveCount = liveCount != null;
  if (hasLiveCount) return liveCount;

  const propsToolCallCount = props.toolCallCount;

  const hasPropsToolCallCount = propsToolCallCount != null;
  if (hasPropsToolCallCount) return propsToolCallCount;

  return 0;
}

function readBranchLabel(props: AppProps): string | undefined {
  const statuslineBranch = props.statusline?.branch;

  const hasPropsStatuslineBranch = statuslineBranch != null;
  if (hasPropsStatuslineBranch) return statuslineBranch;

  return props.branch;
}

function readSessionIdLabel(props: AppProps): string | undefined {
  const liveSessionId = props.session?.getId();

  const hasLiveSessionId = liveSessionId != null;
  if (hasLiveSessionId) return liveSessionId;

  return props.sessionId;
}

function readShortBranchLabel(branch: string | undefined): string {
  const isBranchMissing = branch == null;
  if (isBranchMissing) return NO_GIT_BRANCH_LABEL;

  const isBranchEmpty = branch === "";
  if (isBranchEmpty) return NO_GIT_BRANCH_LABEL;

  const branchLabelMaxLength = 8;

  return truncateString({ text: branch, maxLength: branchLabelMaxLength });
}

function readShortSessionIdLabel(sessionId: string | undefined): string {
  const isSessionIdMissing = sessionId == null;
  if (isSessionIdMissing) return NO_SESSION_LABEL;

  const isSessionIdEmpty = sessionId === "";
  if (isSessionIdEmpty) return NO_SESSION_LABEL;

  const sessionIdLabelLength = 8;

  return sessionId.slice(0, sessionIdLabelLength);
}

function truncateString(details: { text: string; maxLength: number }): string {
  const isLengthAtMostMaxLength = details.text.length <= details.maxLength;
  if (isLengthAtMostMaxLength) return details.text;

  return `${details.text.slice(0, details.maxLength - 1)}…`;
}
