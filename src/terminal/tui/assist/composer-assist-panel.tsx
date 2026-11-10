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
  const { inputSuggestions, queuedPrompt } = props;
  const isPromptSuggestionsGiven = inputSuggestions != null;
  const isQueuedPromptGiven = queuedPrompt != null;

  return (
    <Box flexDirection="column" height={ASSIST_PANEL_HEIGHT} paddingX={1}>
      {flags.showCommandSuggestions && isPromptSuggestionsGiven && (
        <SuggestionMenu suggestions={inputSuggestions} selectedIndex={props.selectedIndex} />
      )}
      {flags.showCommandFallback && (
        <CommandFallbackMenu matches={props.matches} selectedIndex={props.selectedIndex} />
      )}
      {flags.showTypingSuggestions && isPromptSuggestionsGiven && (
        <TypingSuggestionMenu suggestions={inputSuggestions} />
      )}
      {flags.showFiles && <FileMentions fileMentions={props.fileMentions} />}
      {isQueuedPromptGiven && <QueuedPromptPreview prompt={queuedPrompt} />}
      <Text dimColor>
        Ctrl+R history | Up/Down history | Tab suggestion | paste multiline text, Enter sends
      </Text>
    </Box>
  );
};

const readAssistPanelFlags = (props: ComposerAssistPanelProps) => {
  const { inputSuggestions } = props;
  const isPromptSuggestionsMissing = inputSuggestions == null;
  const suggestionElements = isPromptSuggestionsMissing ? [] : inputSuggestions.suggestions;

  const isCommandMode = props.mode === "command-list";
  const hasSuggestionElements = suggestionElements.length > 0;
  const hasCommandMatches = props.matches.length > 0;
  const hasFileMentions = props.fileMentions.length > 0;

  return {
    showCommandSuggestions: isCommandMode && hasSuggestionElements,
    showCommandFallback: isCommandMode && !hasSuggestionElements && hasCommandMatches,
    showTypingSuggestions: props.mode === "typing" && !isPromptSuggestionsMissing,
    showFiles: hasFileMentions && isPromptSuggestionsMissing,
  };
};
