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
  promptSuggestions: PromptSuggestionGroup | null;
  matches: readonly CommandDef[];
  selectedIndex: number;
  fileMentions: readonly string[];
  queuedPrompt: string | null;
};

export const ComposerAssistPanel = (props: ComposerAssistPanelProps) => {
  const flags = readAssistPanelFlags(props);
  const { promptSuggestions, queuedPrompt } = props;
  const isPromptSuggestionsGiven = promptSuggestions != null;
  const isQueuedPromptGiven = queuedPrompt != null;

  return (
    <Box flexDirection="column" height={ASSIST_PANEL_HEIGHT} paddingX={1}>
      {flags.showCommandSuggestions && isPromptSuggestionsGiven && (
        <SuggestionMenu suggestions={promptSuggestions} selectedIndex={props.selectedIndex} />
      )}
      {flags.showCommandFallback && (
        <CommandFallbackMenu matches={props.matches} selectedIndex={props.selectedIndex} />
      )}
      {flags.showTypingSuggestions && isPromptSuggestionsGiven && (
        <TypingSuggestionMenu suggestions={promptSuggestions} />
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
  const { promptSuggestions } = props;
  const isPromptSuggestionsMissing = promptSuggestions == null;
  const suggestionElements = isPromptSuggestionsMissing ? [] : promptSuggestions.suggestions;

  const isCommandMode = props.mode === "command-list";
  const hasSuggestionElements = suggestionElements.length > 0;
  const hasCommandSuggestions = props.matches.length > 0;
  const hasFileMentions = props.fileMentions.length > 0;

  return {
    showCommandSuggestions: isCommandMode && hasSuggestionElements,
    showCommandFallback: isCommandMode && !hasSuggestionElements && hasCommandSuggestions,
    showTypingSuggestions: props.mode === "typing" && !isPromptSuggestionsMissing,
    showFiles: hasFileMentions && isPromptSuggestionsMissing,
  };
};
