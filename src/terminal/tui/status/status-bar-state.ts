import type { TokenCounter } from "@/bridge/context-counter.ts";
import type { AppProps } from "@/terminal/tui/shell/app-types.ts";
import type { StatusBarProps } from "./status-bar.tsx";

export const readStatusBarProps = (details: {
  props: AppProps;
  status: string;
  counter: TokenCounter;
}): StatusBarProps => {
  const { props, status, counter } = details;
  const windowPercent = counter.fraction * 100;
  const branch = readBranchLabel(props);
  const sessionId = readSessionIdLabel(props);

  return {
    shortStatus: truncateString({ text: status, maxLength: 14 }),
    ctxColor: readWindowColor(windowPercent),
    ctxPctLabel: `${windowPercent.toFixed(0)}%`,
    shortModel: truncateString({ text: counter.modelLabel, maxLength: 10 }),
    displayPermissionMode: readPermissionModeLabel(props),
    displayToolCallCount: readToolCallCount(props),
    shortBranch: readShortBranchLabel(branch),
    displaySessionId: readShortSessionIdLabel(sessionId),
  };
};

const readWindowColor = (windowPercent: number): string => {
  const isWindowAlmostFull = windowPercent > 80;
  if (isWindowAlmostFull) return "red";

  const isWindowHalfFull = windowPercent > 50;
  if (isWindowHalfFull) return "yellow";

  return "green";
};

const readPermissionModeLabel = (props: AppProps): string => {
  const liveMode = props.permission?.getMode();

  const hasLiveMode = liveMode != null;
  if (hasLiveMode) return liveMode;

  const hasPropsPermissionMode = props.permissionMode != null;
  if (hasPropsPermissionMode) return props.permissionMode;

  if (props.config.permissionMode != null) return props.config.permissionMode;

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
  if (isBranchMissing) return "nogit";

  const isBranchEmpty = branch === "";
  if (isBranchEmpty) return "nogit";

  return truncateString({ text: branch, maxLength: 8 });
};

const readShortSessionIdLabel = (sessionId: string | undefined): string => {
  const isSessionIdMissing = sessionId == null;
  if (isSessionIdMissing) return "nosess";

  const isSessionIdEmpty = sessionId === "";
  if (isSessionIdEmpty) return "nosess";

  return sessionId.slice(0, 8);
};

const truncateString = (details: { text: string; maxLength: number }): string => {
  const isLengthAtMostMaxLength = details.text.length <= details.maxLength;
  if (isLengthAtMostMaxLength) return details.text;

  return `${details.text.slice(0, details.maxLength - 1)}…`;
};
