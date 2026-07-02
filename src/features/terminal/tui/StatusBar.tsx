import { Box, Text } from "ink";
import { buildStatusBarProps } from "./statusBarHelpers.ts";

/** Props for the compact status bar above the composer. */
export type StatusBarProps = {
  /** Short status message. */
  shortStatus: string;
  /** Context usage percentage color. */
  ctxColor: string;
  /** Context usage percentage label. */
  ctxPctLabel: string;
  /** Short model label. */
  shortModel: string;
  /** Permission mode label. */
  displayPermissionMode: string;
  /** Tool call count label. */
  displayToolCallCount: number;
  /** Short branch label. */
  shortBranch: string;
  /** Short session id label. */
  displaySessionId: string;
};

export { buildStatusBarProps };

/** Renders the compact status bar above the composer. */
export function StatusBar(props: StatusBarProps) {
  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1}>
      <Text dimColor>{props.shortStatus}</Text>
      <Text> | </Text>
      <Text color={props.ctxColor}>ctx {props.ctxPctLabel}</Text>
      <Text> | </Text>
      <Text color="magenta">{props.shortModel}</Text>
      <Text> | </Text>
      <Text dimColor>p:{props.displayPermissionMode}</Text>
      <Text> | </Text>
      <Text dimColor>t:{props.displayToolCallCount}</Text>
      <Text> | </Text>
      <Text dimColor>{props.shortBranch}</Text>
      <Text> | </Text>
      <Text dimColor>{props.displaySessionId}</Text>
    </Box>
  );
}
