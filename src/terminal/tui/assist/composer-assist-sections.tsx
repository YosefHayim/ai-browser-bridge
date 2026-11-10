import { Box, Text } from "ink";
import type { CommandDef } from "@/domain/command-types.ts";
import { VISIBLE_SUGGESTION_LIMIT } from "@/terminal/tui/composer/composer-constants.ts";
import { listVisibleMenuItems } from "@/terminal/tui/shell/visible-menu-items.ts";
import type { InputSuggestionGroup } from "@/terminal/tui/suggestions/types.ts";

export const SuggestionMenu = (props: {
  suggestions: InputSuggestionGroup;
  selectedIndex: number;
}) => {
  const rows = listVisibleMenuItems({
    items: props.suggestions.suggestions,
    selectedIndex: props.selectedIndex,
    limit: VISIBLE_SUGGESTION_LIMIT,
  });
  return (
    <>
      <Text dimColor>{props.suggestions.title}:</Text>
      {rows.map(({ item, index }) => (
        <SuggestionRow
          key={`${item.kind}:${item.value}`}
          label={item.label}
          detail={item.detail}
          selected={index === props.selectedIndex}
        />
      ))}
      {props.suggestions.hint !== undefined && props.suggestions.hint !== "" && (
        <Text dimColor> {props.suggestions.hint}</Text>
      )}
    </>
  );
};

const SuggestionRow = (props: { label: string; detail?: string; selected: boolean }) => {
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
        {props.detail !== undefined ? <Text dimColor> {props.detail}</Text> : null}
      </Text>
    </Box>
  );
};

export const CommandFallbackMenu = (props: {
  matches: readonly CommandDef[];
  selectedIndex: number;
}) => {
  const rows = listVisibleMenuItems({
    items: props.matches,
    selectedIndex: props.selectedIndex,
    limit: VISIBLE_SUGGESTION_LIMIT,
  });
  return (
    <>
      <Text dimColor>Commands:</Text>
      {rows.map(({ item, index }) => (
        <Box key={item.name}>
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
              {item.name.padEnd(14)}
            </Text>
            <Text dimColor> {item.description}</Text>
          </Text>
        </Box>
      ))}
      {props.matches.length > VISIBLE_SUGGESTION_LIMIT && (
        <Text dimColor> ... and {props.matches.length - VISIBLE_SUGGESTION_LIMIT} more</Text>
      )}
    </>
  );
};

export const TypingSuggestionMenu = (props: { suggestions: InputSuggestionGroup }) => {
  return (
    <>
      <Text dimColor>{props.suggestions.title}:</Text>
      {props.suggestions.suggestions.slice(0, VISIBLE_SUGGESTION_LIMIT).map((suggestion, index) => (
        <Text key={`${suggestion.kind}:${suggestion.value}`}>
          {index === 0 ? (
            <Text color="cyan" bold>
              {">"}
            </Text>
          ) : (
            " "
          )}{" "}
          <Text color={index === 0 ? "cyan" : "white"}>{suggestion.label}</Text>
          {suggestion.detail !== undefined ? <Text dimColor> {suggestion.detail}</Text> : null}
        </Text>
      ))}
      {props.suggestions.hint !== undefined && props.suggestions.hint !== "" && (
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
