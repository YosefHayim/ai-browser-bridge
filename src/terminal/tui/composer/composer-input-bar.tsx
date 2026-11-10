import { Box, Text } from "ink";
import TextInput from "ink-text-input";

export type ComposerPromptBarProps = {
  readonly input: string;
  readonly onChange: (field: string) => void;
  readonly onSubmit: (field: string) => void;
};

export const ComposerPromptBar = (props: ComposerPromptBarProps) => {
  return (
    <Box paddingX={1}>
      <Text color="cyan">{">"} </Text>
      <TextInput value={props.input} onChange={props.onChange} onSubmit={props.onSubmit} />
    </Box>
  );
};
