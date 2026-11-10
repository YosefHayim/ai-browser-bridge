import { Box, Text } from "ink";
import type { CommandDef } from "@/domain/command-types.ts";
import { VISIBLE_SUGGESTION_LIMIT } from "@/terminal/tui/composer/composer-constants.ts";
import { listVisibleMenuElements } from "@/terminal/tui/shell/visible-menu-items.ts";
import type { PromptSuggestionGroup } from "@/terminal/tui/suggestions/types.ts";

const SELECTED_COLOR = "cyan";
const IDLE_COLOR = "white";
const SELECTED_MARK = ">";
const SPACE = " ";

const isHintShown = (suggestions: PromptSuggestionGroup) =>
  suggestions.hint != null && suggestions.hint !== "";

export const SuggestionMenu = (props: {
  suggestions: PromptSuggestionGroup;
  selectedIndex: number;
}) => {
  const suggestionLines = listVisibleMenuElements({
    items: props.suggestions.suggestions,
    selectedIndex: props.selectedIndex,
    limit: VISIBLE_SUGGESTION_LIMIT,
  });

  return (
    <>
      <Text dimColor>{props.suggestions.title}:</Text>
      {suggestionLines.map(({ item: element, index }) => (
        <SuggestionLine
          key={`${element.kind}:${element.value}`}
          label={element.label}
          detail={element.detail}
          selected={index === props.selectedIndex}
        />
      ))}
      {isHintShown(props.suggestions) && <Text dimColor> {props.suggestions.hint}</Text>}
    </>
  );
};

const SuggestionLine = (props: { label: string; detail?: string; selected: boolean }) => {
  const isDetailShown = props.detail != null;
  const labelColumnWidth = 16;
  const isSelected = props.selected;
  const labelColor = isSelected ? SELECTED_COLOR : IDLE_COLOR;

  return (
    <Box>
      <Text>
        {props.selected && (
          <Text color={SELECTED_COLOR} bold>
            {SELECTED_MARK}
          </Text>
        )}
        {!props.selected && SPACE}
        {SPACE}
        <Text color={labelColor} bold={props.selected}>
          {props.label.padEnd(labelColumnWidth)}
        </Text>
        {isDetailShown && <Text dimColor> {props.detail}</Text>}
      </Text>
    </Box>
  );
};

export const CommandFallbackMenu = (props: {
  matches: readonly CommandDef[];
  selectedIndex: number;
}) => {
  const suggestionLines = listVisibleMenuElements({
    items: props.matches,
    selectedIndex: props.selectedIndex,
    limit: VISIBLE_SUGGESTION_LIMIT,
  });
  const commandNameColumnWidth = 14;
  const isMoreSuggestionsHidden = props.matches.length > VISIBLE_SUGGESTION_LIMIT;

  return (
    <>
      <Text dimColor>Commands:</Text>
      {suggestionLines.map(({ item: element, index }) => {
        const isSelectedLine = index === props.selectedIndex;
        const labelColor = isSelectedLine ? SELECTED_COLOR : IDLE_COLOR;

        return (
          <Box key={element.name}>
            <Text>
              {isSelectedLine && (
                <Text color={SELECTED_COLOR} bold>
                  {SELECTED_MARK}
                </Text>
              )}
              {!isSelectedLine && SPACE}
              {" /"}
              <Text color={labelColor} bold={isSelectedLine}>
                {element.name.padEnd(commandNameColumnWidth)}
              </Text>
              <Text dimColor> {element.description}</Text>
            </Text>
          </Box>
        );
      })}
      {isMoreSuggestionsHidden && (
        <Text dimColor> ... and {props.matches.length - VISIBLE_SUGGESTION_LIMIT} more</Text>
      )}
    </>
  );
};

export const TypingSuggestionMenu = (props: { suggestions: PromptSuggestionGroup }) => {
  return (
    <>
      <Text dimColor>{props.suggestions.title}:</Text>
      {props.suggestions.suggestions.slice(0, VISIBLE_SUGGESTION_LIMIT).map((suggestion, index) => {
        const isDetailShown = suggestion.detail != null;
        const isFirstSuggestion = index === 0;
        const labelColor = isFirstSuggestion ? SELECTED_COLOR : IDLE_COLOR;

        return (
          <Text key={`${suggestion.kind}:${suggestion.value}`}>
            {isFirstSuggestion && (
              <Text color={SELECTED_COLOR} bold>
                {SELECTED_MARK}
              </Text>
            )}
            {!isFirstSuggestion && SPACE} <Text color={labelColor}>{suggestion.label}</Text>
            {isDetailShown && <Text dimColor> {suggestion.detail}</Text>}
          </Text>
        );
      })}
      {isHintShown(props.suggestions) && <Text dimColor> {props.suggestions.hint}</Text>}
    </>
  );
};

export const FileMentions = (props: { fileMentions: readonly string[] }) => {
  return (
    <Text>
      <Text dimColor>Files: </Text>
      <Text color="cyan">{props.fileMentions.map((file) => `@${file}`).join(SPACE)}</Text>
    </Text>
  );
};

export const QueuedPromptPreview = (props: { prompt: string }) => {
  const previewCharacterLimit = 80;

  return (
    <Text>
      <Text dimColor>Queued: </Text>
      <Text color="yellow">{props.prompt.slice(0, previewCharacterLimit)}</Text>
    </Text>
  );
};
