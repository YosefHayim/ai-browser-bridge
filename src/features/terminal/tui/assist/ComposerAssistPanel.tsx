import type { CommandDef } from "@/features/domain";
import { Box, Text } from "ink";
import { ASSIST_PANEL_HEIGHT } from "../composer/composerConstants.ts";
import type { InputMode } from "../shell/appTypes.ts";
import type { InputSuggestionGroup } from "../suggestions/inputSuggestions.ts";
import {
  CommandFallbackMenu,
  FileMentions,
  QueuedPromptPreview,
  SuggestionMenu,
  TypingSuggestionMenu,
} from "./ComposerAssistSections.tsx";

/** Props for the composer assist panel below the input bar. */
export type ComposerAssistPanelProps = {
  /** Current composer input mode. */
  mode: InputMode;
  /** Loaded input suggestions, if any. */
  inputSuggestions: InputSuggestionGroup | null;
  /** Slash commands matching the current prefix. */
  matches: readonly CommandDef[];
  /** Selected suggestion or command index. */
  selectedIdx: number;
  /** File mentions detected in the current input. */
  fileMentions: readonly string[];
  /** Queued prompt waiting for the active response. */
  queuedPrompt: string | null;
};

/**
 * Renders command, suggestion, file, and queue hints beneath the input.
 *
 * @param props - Props passed to the component.
 * @returns The rendered component.
 * @example
 * ```tsx
 * const node = <ComposerAssistPanel {...props} />;
 * ```
 */
export const ComposerAssistPanel = (props: ComposerAssistPanelProps) => {
  const flags = assistPanelFlags(props);
  return (
    <Box flexDirection="column" height={ASSIST_PANEL_HEIGHT} paddingX={1}>
      {flags.showCommandSuggestions && props.inputSuggestions && (
        <SuggestionMenu suggestions={props.inputSuggestions} selectedIdx={props.selectedIdx} />
      )}
      {flags.showCommandFallback && (
        <CommandFallbackMenu matches={props.matches} selectedIdx={props.selectedIdx} />
      )}
      {flags.showTypingSuggestions && props.inputSuggestions && (
        <TypingSuggestionMenu suggestions={props.inputSuggestions} />
      )}
      {flags.showFiles && <FileMentions fileMentions={props.fileMentions} />}
      {props.queuedPrompt && <QueuedPromptPreview prompt={props.queuedPrompt} />}
      <Text dimColor>
        Ctrl+R history | Up/Down history | Tab suggestion | paste multiline text, Enter sends
      </Text>
    </Box>
  );
};

const assistPanelFlags = (props: ComposerAssistPanelProps) => {
  const suggestions = props.inputSuggestions?.suggestions ?? [];
  return {
    showCommandSuggestions: props.mode === "command-list" && suggestions.length > 0,
    showCommandFallback:
      props.mode === "command-list" && suggestions.length === 0 && props.matches.length > 0,
    showTypingSuggestions: props.mode === "typing" && Boolean(props.inputSuggestions),
    showFiles: props.fileMentions.length > 0 && !props.inputSuggestions,
  };
};
