import { Box, Text } from "ink";
import type { Message } from "@/features/domain";
import { messageRoleTheme } from "./roleThemeConfig.ts";

/** Props for the scrollable message pane. */
export type MessagePaneProps = {
  messages: Message[];
};

/** Renders the conversation message list. */
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
  const theme = messageRoleTheme(props.message.role);
  const preview = formatMessagePreview(props.message.content);

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
      {renderToolCalls(props.message)}
    </Box>
  );
};

const formatMessagePreview = (content: string): string => {
  if (content.length <= 500) return content;
  return `${content.slice(0, 500)}...`;
};

const renderToolCalls = (message: Message) => {
  if (!message.toolCalls?.length) return null;
  return (
    <Box marginLeft={2}>
      <Text dimColor>[tools: {message.toolCalls.map((toolCall) => toolCall.name).join(", ")}]</Text>
    </Box>
  );
};
