import { Box, Text } from "ink";
import type { Message } from "@/domain/message-types.ts";
import { readMessageRoleTheme } from "./role-theme-config.ts";

export type MessagePaneProps = {
  messages: Message[];
};

export const MessagePane = (props: MessagePaneProps) => {
  return (
    <Box flexDirection="column" flexGrow={1} overflowY="hidden">
      {props.messages.map((message) => (
        <MessageLine key={message.id} message={message} />
      ))}
    </Box>
  );
};

type MessageLineProps = {
  message: Message;
};

const MessageLine = (props: MessageLineProps) => {
  const theme = readMessageRoleTheme(props.message.role);
  const preview = createMessagePreview(props.message.content);

  return (
    <Box flexDirection="column" marginBottom={0}>
      <Text>
        <Text color={theme.color} backgroundColor={theme.backgroundColor} bold>
          {theme.prefix} {theme.label}:{" "}
        </Text>{" "}
        <Text color={theme.color} backgroundColor={theme.backgroundColor}>
          {preview}
        </Text>
      </Text>
      {showToolCalls(props.message)}
    </Box>
  );
};

const createMessagePreview = (message: string): string => {
  const isShortMessage = message.length <= 500;
  if (isShortMessage) return message;

  return `${message.slice(0, 500)}...`;
};

const showToolCalls = (message: Message) => {
  const toolCalls = message.toolCalls;
  const isToolCallsBlank = toolCalls == null || toolCalls.length === 0;
  if (isToolCallsBlank) return null;

  return (
    <Box marginLeft={2}>
      <Text dimColor>[tools: {toolCalls.map((toolCall) => toolCall.name).join(", ")}]</Text>
    </Box>
  );
};
