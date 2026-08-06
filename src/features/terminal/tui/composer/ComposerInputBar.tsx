import { Box, Text } from "ink";
import TextInput from "ink-text-input";

export type ComposerInputBarProps = {
  readonly input: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: (value: string) => void;
};

export const ComposerInputBar = (props: ComposerInputBarProps) => {
  return (
    <Box paddingX={1}>
      <Text color="cyan">{">"} </Text>
      <TextInput value={props.input} onChange={props.onChange} onSubmit={props.onSubmit} />
    </Box>
  );
};
