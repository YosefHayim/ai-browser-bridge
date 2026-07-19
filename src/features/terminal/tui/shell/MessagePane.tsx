import type { Message } from "@/features/domain";
import { Box, Text } from "ink";
import { getMessageRoleTheme } from "./roleThemeConfig.ts";

/** Props for the scrollable message pane. */
export type MessagePaneProps = {
  /** Messages to render. */
  messages: Message[];
};

/**
 * Renders the conversation message list.
 *
 * @param props - Props passed to the component.
 * @returns The rendered component.
 * @example
 * ```tsx
 * const node = <MessagePane {...props} />;
 * ```
 */
export const MessagePane = (props: MessagePaneProps) => {
  return (
    <Box flexDirection="column" flexGrow={1} overflowY="hidden">
      {props.messages.map((message) => (
        <MessageRow key={message.id} message={message} />
      ))}
    </Box>
  );
};

/** Props for a single rendered message row. */
type MessageRowProps = {
  /** Message to display. */
  message: Message;
};

const MessageRow = (props: MessageRowProps) => {
  const theme = getMessageRoleTheme(props.message.role);
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
