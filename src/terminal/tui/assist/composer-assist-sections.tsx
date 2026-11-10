import { Box, Text } from "ink";
import type { CommandDef } from "@/domain/command-types.ts";
import { VISIBLE_SUGGESTION_LIMIT } from "@/terminal/tui/composer/composer-constants.ts";
import { listVisibleMenuElements } from "@/terminal/tui/shell/visible-menu-items.ts";
import type { PromptSuggestionGroup } from "@/terminal/tui/suggestions/types.ts";

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
      {props.suggestions.hint != null && props.suggestions.hint !== "" && (
        <Text dimColor> {props.suggestions.hint}</Text>
      )}
    </>
  );
};

const SuggestionLine = (props: { label: string; detail?: string; selected: boolean }) => {
  const isDetailShown = props.detail != null;

  return (
    <Box>
      <Text>
        {props.selected ? (
          <Text color="cyan" bold>
            {">"}
          </Text>
        ) : (
          " "
        )}{" "}
        <Text color={props.selected ? "cyan" : "white"} bold={props.selected}>
          {props.label.padEnd(16)}
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
  return (
    <>
      <Text dimColor>Commands:</Text>
      {suggestionLines.map(({ item: element, index }) => (
        <Box key={element.name}>
          <Text>
            {index === props.selectedIndex ? (
              <Text color="cyan" bold>
                {">"}
              </Text>
            ) : (
              " "
            )}
            {" /"}
            <Text
              color={index === props.selectedIndex ? "cyan" : "white"}
              bold={index === props.selectedIndex}
            >
              {element.name.padEnd(14)}
            </Text>
            <Text dimColor> {element.description}</Text>
          </Text>
        </Box>
      ))}
      {props.matches.length > VISIBLE_SUGGESTION_LIMIT && (
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
        const labelColor = isFirstSuggestion ? "cyan" : "white";

        return (
          <Text key={`${suggestion.kind}:${suggestion.value}`}>
            {isFirstSuggestion && (
              <Text color="cyan" bold>
                {">"}
              </Text>
            )}
            {!isFirstSuggestion && " "} <Text color={labelColor}>{suggestion.label}</Text>
            {isDetailShown && <Text dimColor> {suggestion.detail}</Text>}
          </Text>
        );
      })}
      {props.suggestions.hint != null && props.suggestions.hint !== "" && (
        <Text dimColor> {props.suggestions.hint}</Text>
      )}
    </>
  );
};

export const FileMentions = (props: { fileMentions: readonly string[] }) => {
  return (
    <Text>
      <Text dimColor>Files: </Text>
      <Text color="cyan">{props.fileMentions.map((file) => `@${file}`).join(" ")}</Text>
    </Text>
  );
};

export const QueuedPromptPreview = (props: { prompt: string }) => {
  return (
    <Text>
      <Text dimColor>Queued: </Text>
      <Text color="yellow">{props.prompt.slice(0, 80)}</Text>
    </Text>
  );
};
