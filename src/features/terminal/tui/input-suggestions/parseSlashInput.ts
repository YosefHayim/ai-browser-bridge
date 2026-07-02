import type { ActiveArgumentToken, ParsedSlashInput } from "./types.ts";

/** Parse a slash-command input string into command name and args. */
export function parseSlashInput(input: string): ParsedSlashInput | null {
  if (!input.startsWith("/")) return null;
  const spaceIndex = input.indexOf(" ");
  if (spaceIndex === -1) return { command: input.slice(1), args: "", argsStart: input.length };
  return {
    command: input.slice(1, spaceIndex),
    args: input.slice(spaceIndex + 1),
    argsStart: spaceIndex + 1,
  };
}

/** Extract the active argument token at the end of slash command args. */
export function activeArgumentToken(slash: ParsedSlashInput): ActiveArgumentToken {
  const beforeCursor = slash.args;
  const match = /(?:^|\s)(\S*)$/.exec(beforeCursor);
  const value = match?.[1] ?? "";
  const start = slash.argsStart + beforeCursor.length - value.length;
  return { start, end: slash.argsStart + beforeCursor.length, value };
}

/** Split slash command args on whitespace. */
export function splitArgs(input: string): string[] {
  return input.trim().split(/\s+/).filter(Boolean);
}

/** Whether the args string ends with trailing whitespace. */
export function hasTrailingWhitespace(input: string): boolean {
  return /\s$/.test(input);
}
