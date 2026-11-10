import type { TokenCounter } from "@/bridge/context-counter.ts";
import type { AppProps } from "@/terminal/tui/shell/app-types.ts";
import type { StatusBarProps } from "./status-bar.tsx";

export const readStatusBarProps = (input: {
  props: AppProps;
  status: string;
  counter: TokenCounter;
}): StatusBarProps => {
  const { props, status, counter } = input;
  const contextPercent = counter.fraction * 100;
  const branch = readBranchLabel(props);
  const sessionId = readSessionIdLabel(props);

  return {
    shortStatus: truncateText({ text: status, maxLength: 14 }),
    ctxColor: readContextColor(contextPercent),
    ctxPctLabel: `${contextPercent.toFixed(0)}%`,
    shortModel: truncateText({ text: counter.modelLabel, maxLength: 10 }),
    displayPermissionMode: readPermissionModeLabel(props),
    displayToolCallCount: readToolCallCount(props),
    shortBranch: readShortBranchLabel(branch),
    displaySessionId: readShortSessionIdLabel(sessionId),
  };
};

const readContextColor = (contextPercent: number): string => {
  const isWindowAlmostFull = contextPercent > 80;
  if (isWindowAlmostFull) return "red";

  const isWindowHalfFull = contextPercent > 50;
  if (isWindowHalfFull) return "yellow";

  return "green";
};

const readPermissionModeLabel = (props: AppProps): string => {
  const liveMode = props.permission?.getMode();

  const hasLiveMode = liveMode !== undefined;
  if (hasLiveMode) return liveMode;

  const hasPropsPermissionMode = props.permissionMode !== undefined;
  if (hasPropsPermissionMode) return props.permissionMode;

  if (props.config.permissionMode !== undefined) return props.config.permissionMode;

  return "auto";
};

const readToolCallCount = (props: AppProps): number => {
  const liveCount = props.statusline?.toolCallCount();

  const hasLiveCount = liveCount !== undefined;
  if (hasLiveCount) return liveCount;

  const hasPropsToolCallCount = props.toolCallCount !== undefined;
  if (hasPropsToolCallCount) return props.toolCallCount;

  return 0;
};

const readBranchLabel = (props: AppProps): string | undefined => {
  const hasPropsStatuslineBranch = props.statusline?.branch !== undefined;
  if (hasPropsStatuslineBranch) return props.statusline.branch;

  return props.branch;
};

const readSessionIdLabel = (props: AppProps): string | undefined => {
  const liveSessionId = props.session?.getId();

  const hasLiveSessionId = liveSessionId !== undefined;
  if (hasLiveSessionId) return liveSessionId;

  return props.sessionId;
};

const readShortBranchLabel = (branch: string | undefined): string => {
  const isBranchMissing = branch === undefined;
  if (isBranchMissing) return "nogit";

  const isBranchEmpty = branch === "";
  if (isBranchEmpty) return "nogit";

  return truncateText({ text: branch, maxLength: 8 });
};

const readShortSessionIdLabel = (sessionId: string | undefined): string => {
  const isSessionIdMissing = sessionId === undefined;
  if (isSessionIdMissing) return "nosess";

  const isSessionIdEmpty = sessionId === "";
  if (isSessionIdEmpty) return "nosess";

  return sessionId.slice(0, 8);
};

const truncateText = (input: { text: string; maxLength: number }): string => {
  const isLengthAtMostMaxLength = input.text.length <= input.maxLength;
  if (isLengthAtMostMaxLength) return input.text;

  return `${input.text.slice(0, input.maxLength - 1)}…`;
};
