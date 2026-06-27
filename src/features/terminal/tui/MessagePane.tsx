import { Box, Text } from "ink";
import type { Message } from "../../domain/types.ts";
import { getMessageRoleTheme } from "./role-theme.config.ts";

/** Props for the scrollable message pane. */
export type MessagePaneProps = {
  /** Messages to render. */
  messages: Message[];
};

/** Renders the conversation message list. */
export function MessagePane(props: MessagePaneProps) {
  return (
    <Box flexDirection="column" flexGrow={1} overflowY="hidden">
      {props.messages.map((message) => (
        <MessageRow key={message.id} message={message} />
      ))}
    </Box>
  );
}

/** Props for a single rendered message row. */
type MessageRowProps = {
  /** Message to display. */
  message: Message;
};

function MessageRow(props: MessageRowProps) {
  const theme = getMessageRoleTheme(props.message.role);
  const preview = formatMessagePreview(props.message.content);

  return (
    <Box flexDirection="column" marginBottom={0}>
      <Text>
        <Text color={theme.color} backgroundColor={theme.backgroundColor} bold>
          {theme.prefix} {theme.label}:{" "}
        </Text>
        {" "}
        <Text color={theme.color} backgroundColor={theme.backgroundColor}>{preview}</Text>
      </Text>
      {renderToolCalls(props.message)}
    </Box>
  );
}

function formatMessagePreview(content: string): string {
  if (content.length <= 500) return content;
  return `${content.slice(0, 500)}...`;
}

function renderToolCalls(message: Message) {
  if (!message.toolCalls?.length) return null;
  return (
    <Box marginLeft={2}>
      <Text dimColor>[tools: {message.toolCalls.map((toolCall) => toolCall.name).join(", ")}]</Text>
    </Box>
  );
}
