import { Box, Text } from "ink";
import TextInput from "ink-text-input";

/** Props for the composer input row. */
export type ComposerInputBarProps = {
  /** Current input value. */
  input: string;
  /** Input change handler. */
  onChange: (value: string) => void;
  /** Submit handler. */
  onSubmit: (value: string) => void;
};

/**
 * Renders the prompt input row.
 *
 * @param props - Props passed to the component.
 * @returns The rendered component.
 * @example
 * ```tsx
 * const node = <ComposerInputBar {...props} />;
 * ```
 */
export const ComposerInputBar = (props: ComposerInputBarProps) => {
  return (
    <Box paddingX={1}>
      <Text color="cyan">{">"} </Text>
      <TextInput value={props.input} onChange={props.onChange} onSubmit={props.onSubmit} />
    </Box>
  );
};
