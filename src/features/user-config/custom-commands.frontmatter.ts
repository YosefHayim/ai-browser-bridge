import type { CustomCommandMetadata } from "./custom-commands.types.ts";
import { parseInlineList, stripYamlQuotes } from "./custom-commands.text.helpers.ts";

interface ParseFrontmatterInput {
  lines: string[];
}

/** Parse optional YAML-like frontmatter lines into metadata. */
export function parseFrontmatter(input: ParseFrontmatterInput | string[]): CustomCommandMetadata {
  const lines = Array.isArray(input) ? input : input.lines;
  const metadata: CustomCommandMetadata = {};
  for (let index = 0; index < lines.length; index += 1) {
    index = applyFrontmatterLine({ metadata, lines, index }) ?? index;
  }
  return metadata;
}

function applyFrontmatterLine(input: {
  metadata: CustomCommandMetadata;
  lines: string[];
  index: number;
}): number | undefined {
  const keyValue = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(input.lines[input.index] ?? "");
  if (!keyValue) return undefined;
  return applyFrontmatterKey({
    metadata: input.metadata,
    lines: input.lines,
    index: input.index,
    key: keyValue[1],
    value: keyValue[2].trim(),
  });
}

function applyFrontmatterKey(input: {
  metadata: CustomCommandMetadata;
  lines: string[];
  index: number;
  key: string;
  value: string;
}): number | undefined {
  if (input.key === "description") input.metadata.description = stripYamlQuotes(input.value);
  if (input.key === "model") input.metadata.model = stripYamlQuotes(input.value);
  if (input.key === "allowedTools") return parseAllowedTools({ metadata: input.metadata, lines: input.lines, index: input.index, value: input.value });
  return input.index;
}

function parseAllowedTools(input: {
  metadata: CustomCommandMetadata;
  lines: string[];
  index: number;
  value: string;
}): number {
  if (input.value) {
    input.metadata.allowedTools = parseInlineList(input.value);
    return input.index;
  }
  return parseAllowedToolsList(input);
}

function parseAllowedToolsList(input: {
  metadata: CustomCommandMetadata;
  lines: string[];
  index: number;
}): number {
  const list: string[] = [];
  let index = input.index;
  while (index + 1 < input.lines.length) {
    const listItem = /^\s*-\s*(.+)$/.exec(input.lines[index + 1] ?? "");
    if (!listItem) break;
    list.push(stripYamlQuotes(listItem[1].trim()));
    index += 1;
  }
  input.metadata.allowedTools = list;
  return index;
}
