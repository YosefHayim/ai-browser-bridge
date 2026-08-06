import type { ContextCounter } from "@/features/bridge";
import type { AppProps } from "../shell/appTypes.ts";
import type { StatusBarProps } from "./StatusBar.tsx";

export const statusBarProps = (input: {
  props: AppProps;
  status: string;
  counter: ContextCounter;
}): StatusBarProps => {
  const { props, status, counter } = input;
  const contextPercent = counter.fraction * 100;
  const branch = branchLabel(props);
  const sessionId = sessionIdLabel(props);

  return {
    shortStatus: truncateText({ text: status, maxLength: 14 }),
    ctxColor: contextColor(contextPercent),
    ctxPctLabel: `${contextPercent.toFixed(0)}%`,
    shortModel: truncateText({ text: counter.modelLabel, maxLength: 10 }),
    displayPermissionMode: permissionModeLabel(props),
    displayToolCallCount: toolCallCount(props),
    shortBranch: shortBranchLabel(branch),
    displaySessionId: shortSessionIdLabel(sessionId),
  };
};

const contextColor = (contextPercent: number): string => {
  if (contextPercent > 80) return "red";
  if (contextPercent > 50) return "yellow";
  return "green";
};

const permissionModeLabel = (props: AppProps): string => {
  const liveMode = props.permission?.getMode();
  if (liveMode !== undefined) return liveMode;
  if (props.permissionMode !== undefined) return props.permissionMode;
  if (props.config.permissionMode !== undefined) return props.config.permissionMode;
  return "auto";
};

const toolCallCount = (props: AppProps): number => {
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

const shortBranchLabel = (branch: string | undefined): string => {
  if (branch === undefined) return "nogit";
  if (branch === "") return "nogit";
  return truncateText({ text: branch, maxLength: 8 });
};

const shortSessionIdLabel = (sessionId: string | undefined): string => {
  if (sessionId === undefined) return "nosess";
  if (sessionId === "") return "nosess";
  return sessionId.slice(0, 8);
};

const truncateText = (input: { text: string; maxLength: number }): string => {
  if (input.text.length <= input.maxLength) return input.text;
  return `${input.text.slice(0, input.maxLength - 1)}…`;
};
