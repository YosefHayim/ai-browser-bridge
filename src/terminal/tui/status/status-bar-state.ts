import type { TokenCounter } from "@/bridge/context-counter.ts";
import type { AppProps } from "@/terminal/tui/shell/app-types.ts";
import type { StatusBarProps } from "./status-bar.tsx";

const NO_SESSION_LABEL = "nosess";

const NO_GIT_BRANCH_LABEL = "nogit";

export const readStatusBarProps = (details: {
  props: AppProps;
  status: string;
  counter: TokenCounter;
}): StatusBarProps => {
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
};

const readWindowColor = (windowPercent: number): string => {
  const almostFullWindowPercent = 80;

  const isWindowAlmostFull = windowPercent > almostFullWindowPercent;
  if (isWindowAlmostFull) return "red";

  const halfFullWindowPercent = 50;

  const isWindowHalfFull = windowPercent > halfFullWindowPercent;
  if (isWindowHalfFull) return "yellow";

  return "green";
};

const readPermissionModeLabel = (props: AppProps): string => {
  const liveMode = props.permission?.getMode();

  const hasLiveMode = liveMode != null;
  if (hasLiveMode) return liveMode;

  const hasPropsPermissionMode = props.permissionMode != null;
  if (hasPropsPermissionMode) return props.permissionMode;

  const hasSettingsPermissionMode = props.config.permissionMode != null;
  if (hasSettingsPermissionMode) return props.config.permissionMode;

  return "auto";
};

const readToolCallCount = (props: AppProps): number => {
  const liveCount = props.statusline?.toolCallCount();

  const hasLiveCount = liveCount != null;
  if (hasLiveCount) return liveCount;

  const hasPropsToolCallCount = props.toolCallCount != null;
  if (hasPropsToolCallCount) return props.toolCallCount;

  return 0;
};

const readBranchLabel = (props: AppProps): string | undefined => {
  const hasPropsStatuslineBranch = props.statusline?.branch != null;
  if (hasPropsStatuslineBranch) return props.statusline.branch;

  return props.branch;
};

const readSessionIdLabel = (props: AppProps): string | undefined => {
  const liveSessionId = props.session?.getId();

  const hasLiveSessionId = liveSessionId != null;
  if (hasLiveSessionId) return liveSessionId;

  return props.sessionId;
};

const readShortBranchLabel = (branch: string | undefined): string => {
  const isBranchMissing = branch == null;
  if (isBranchMissing) return NO_GIT_BRANCH_LABEL;

  const isBranchEmpty = branch === "";
  if (isBranchEmpty) return NO_GIT_BRANCH_LABEL;

  const branchLabelMaxLength = 8;

  return truncateString({ text: branch, maxLength: branchLabelMaxLength });
};

const readShortSessionIdLabel = (sessionId: string | undefined): string => {
  const isSessionIdMissing = sessionId == null;
  if (isSessionIdMissing) return NO_SESSION_LABEL;

  const isSessionIdEmpty = sessionId === "";
  if (isSessionIdEmpty) return NO_SESSION_LABEL;

  const sessionIdLabelLength = 8;

  return sessionId.slice(0, sessionIdLabelLength);
};

const truncateString = (details: { text: string; maxLength: number }): string => {
  const isLengthAtMostMaxLength = details.text.length <= details.maxLength;
  if (isLengthAtMostMaxLength) return details.text;

  return `${details.text.slice(0, details.maxLength - 1)}…`;
};
