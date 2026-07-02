import { Box, Text } from "ink";
import type { CommandDef } from "../../domain/types.ts";
import { VISIBLE_SUGGESTION_LIMIT } from "./composerConstants.ts";
import type { InputSuggestionGroup } from "./inputSuggestions.ts";
import { visibleMenuItems } from "./visibleMenuItems.ts";

export function SuggestionMenu(props: { suggestions: InputSuggestionGroup; selectedIdx: number }) {
  const rows = visibleMenuItems({
    items: props.suggestions.suggestions,
    selectedIdx: props.selectedIdx,
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
          selected={index === props.selectedIdx}
        />
      ))}
      {props.suggestions.hint && <Text dimColor> {props.suggestions.hint}</Text>}
    </>
  );
}

function SuggestionRow(props: { label: string; detail?: string; selected: boolean }) {
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
        {props.detail ? <Text dimColor> {props.detail}</Text> : null}
      </Text>
    </Box>
  );
}

export function CommandFallbackMenu(props: {
  matches: readonly CommandDef[];
  selectedIdx: number;
}) {
  const rows = visibleMenuItems({
    items: props.matches,
    selectedIdx: props.selectedIdx,
    limit: VISIBLE_SUGGESTION_LIMIT,
  });
  return (
    <>
      <Text dimColor>Commands:</Text>
      {rows.map(({ item, index }) => (
        <Box key={item.name}>
          <Text>
            {index === props.selectedIdx ? (
              <Text color="cyan" bold>
                {">"}
              </Text>
            ) : (
              " "
            )}
            {" /"}
            <Text
              color={index === props.selectedIdx ? "cyan" : "white"}
              bold={index === props.selectedIdx}
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
}

export function TypingSuggestionMenu(props: { suggestions: InputSuggestionGroup }) {
  return (
    <>
      <Text dimColor>{props.suggestions.title}:</Text>
      {props.suggestions.suggestions
        .slice(0, VISIBLE_SUGGESTION_LIMIT)
        .map((...args: [InputSuggestionGroup["suggestions"][number], number]) => (
          <Text key={`${args[0].kind}:${args[0].value}`}>
            {args[1] === 0 ? (
              <Text color="cyan" bold>
                {">"}
              </Text>
            ) : (
              " "
            )}{" "}
            <Text color={args[1] === 0 ? "cyan" : "white"}>{args[0].label}</Text>
            {args[0].detail ? <Text dimColor> {args[0].detail}</Text> : null}
          </Text>
        ))}
      {props.suggestions.hint && <Text dimColor> {props.suggestions.hint}</Text>}
    </>
  );
}

export function FileMentions(props: { fileMentions: readonly string[] }) {
  return (
    <Text>
      <Text dimColor>Files: </Text>
      <Text color="cyan">{props.fileMentions.map((file) => `@${file}`).join(" ")}</Text>
    </Text>
  );
}

export function QueuedPromptPreview(props: { prompt: string }) {
  return (
    <Text>
      <Text dimColor>Queued: </Text>
      <Text color="yellow">{props.prompt.slice(0, 80)}</Text>
    </Text>
  );
}
