import { Box, Text } from "ink";
import type { CommandDef } from "@/domain/command-types.ts";
import { ASSIST_PANEL_HEIGHT } from "@/terminal/tui/composer/composer-constants.ts";
import type { PromptMode } from "@/terminal/tui/shell/app-types.ts";
import type { PromptSuggestionGroup } from "@/terminal/tui/suggestions/types.ts";
import {
  CommandFallbackMenu,
  FileMentions,
  QueuedPromptPreview,
  SuggestionMenu,
  TypingSuggestionMenu,
} from "./composer-assist-sections.tsx";

export type ComposerAssistPanelProps = {
  mode: PromptMode;
  inputSuggestions: PromptSuggestionGroup | null;
  matches: readonly CommandDef[];
  selectedIndex: number;
  fileMentions: readonly string[];
  queuedPrompt: string | null;
};

export const ComposerAssistPanel = (props: ComposerAssistPanelProps) => {
  const flags = readAssistPanelFlags(props);

  return (
    <Box flexDirection="column" height={ASSIST_PANEL_HEIGHT} paddingX={1}>
      {flags.showCommandSuggestions && props.inputSuggestions != null && (
        <SuggestionMenu suggestions={props.inputSuggestions} selectedIndex={props.selectedIndex} />
      )}
      {flags.showCommandFallback && (
        <CommandFallbackMenu matches={props.matches} selectedIndex={props.selectedIndex} />
      )}
      {flags.showTypingSuggestions && props.inputSuggestions != null && (
        <TypingSuggestionMenu suggestions={props.inputSuggestions} />
      )}
      {flags.showFiles && <FileMentions fileMentions={props.fileMentions} />}
      {props.queuedPrompt != null && <QueuedPromptPreview prompt={props.queuedPrompt} />}
      <Text dimColor>
        Ctrl+R history | Up/Down history | Tab suggestion | paste multiline text, Enter sends
      </Text>
    </Box>
  );
};

const readAssistPanelFlags = (props: ComposerAssistPanelProps) => {
  const suggestionElements =
    props.inputSuggestions == null ? [] : props.inputSuggestions.suggestions;

  return {
    showCommandSuggestions: props.mode === "command-list" && suggestionElements.length > 0,
    showCommandFallback:
      props.mode === "command-list" && suggestionElements.length === 0 && props.matches.length > 0,
    showTypingSuggestions: props.mode === "typing" && props.inputSuggestions != null,
    showFiles: props.fileMentions.length > 0 && props.inputSuggestions == null,
  };
};
