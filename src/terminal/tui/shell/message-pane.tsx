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
        <MessageRow key={message.id} message={message} />
      ))}
    </Box>
  );
};

type MessageRowProps = {
  message: Message;
};

const MessageRow = (props: MessageRowProps) => {
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

const createMessagePreview = (content: string): string => {
  const isShortMessage = content.length <= 500;
  if (isShortMessage) return content;

  return `${content.slice(0, 500)}...`;
};

const showToolCalls = (message: Message) => {
  const toolCalls = message.toolCalls;
  const isToolCallsBlank = toolCalls === undefined || toolCalls.length === 0;
  if (isToolCallsBlank) return null;

  return (
    <Box marginLeft={2}>
      <Text dimColor>[tools: {toolCalls.map((toolCall) => toolCall.name).join(", ")}]</Text>
    </Box>
  );
};
