import { Box, Text } from "ink";

export type StatusBarProps = {
  readonly shortStatus: string;
  readonly ctxColor: string;
  readonly ctxPctLabel: string;
  readonly shortModel: string;
  readonly displayPermissionMode: string;
  readonly displayToolCallCount: number;
  readonly shortBranch: string;
  readonly displaySessionId: string;
};

export const StatusBar = (props: StatusBarProps) => (
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
