import { Box, Text } from "ink";
import type { CommandDef } from "@/features/domain";
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

export type ComposerAssistPanelProps = {
  mode: InputMode;
  inputSuggestions: InputSuggestionGroup | null;
  matches: readonly CommandDef[];
  selectedIdx: number;
  fileMentions: readonly string[];
  queuedPrompt: string | null;
};

export const ComposerAssistPanel = (props: ComposerAssistPanelProps) => {
  const flags = assistPanelFlags(props);
  return (
    <Box flexDirection="column" height={ASSIST_PANEL_HEIGHT} paddingX={1}>
      {flags.showCommandSuggestions && props.inputSuggestions !== null && (
        <SuggestionMenu suggestions={props.inputSuggestions} selectedIdx={props.selectedIdx} />
      )}
      {flags.showCommandFallback && (
        <CommandFallbackMenu matches={props.matches} selectedIdx={props.selectedIdx} />
      )}
      {flags.showTypingSuggestions && props.inputSuggestions !== null && (
        <TypingSuggestionMenu suggestions={props.inputSuggestions} />
      )}
      {flags.showFiles && <FileMentions fileMentions={props.fileMentions} />}
      {props.queuedPrompt !== null && <QueuedPromptPreview prompt={props.queuedPrompt} />}
      <Text dimColor>
        Ctrl+R history | Up/Down history | Tab suggestion | paste multiline text, Enter sends
      </Text>
    </Box>
  );
};

const assistPanelFlags = (props: ComposerAssistPanelProps) => {
  const suggestionItems = props.inputSuggestions === null ? [] : props.inputSuggestions.suggestions;
  return {
    showCommandSuggestions: props.mode === "command-list" && suggestionItems.length > 0,
    showCommandFallback:
      props.mode === "command-list" && suggestionItems.length === 0 && props.matches.length > 0,
    showTypingSuggestions: props.mode === "typing" && props.inputSuggestions !== null,
    showFiles: props.fileMentions.length > 0 && props.inputSuggestions === null,
  };
};
