import type { CustomCommand } from "./custom-commands.types.ts";

/** Compare custom commands for stable sorting by name then source. */
export function compareCustomCommands(left: CustomCommand, right: CustomCommand): number {
  const byName = left.name.localeCompare(right.name);
  return byName !== 0 ? byName : left.source.localeCompare(right.source);
}

/** Locale-aware string comparator for sorting file names. */
export function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

interface TemplateReplacementInput {
  match: string;
  argumentsText: string;
  parsedArgs: string[];
}

/** Replace one $ARGUMENTS or positional placeholder in a command template. */
export function renderTemplateReplacement(input: TemplateReplacementInput): string {
  if (input.match === "$ARGUMENTS") return input.argumentsText;
  const index = Number.parseInt(input.match.slice(1), 10) - 1;
  return input.parsedArgs[index] ?? "";
}
