import type { ActiveArgumentToken, ParsedSlashInput } from "./types.ts";

/** Parse a slash-command input string into command name and args. */
export const parseSlashInput = (input: string): ParsedSlashInput | undefined => {
  if (!input.startsWith("/")) return undefined;
  const spaceIndex = input.indexOf(" ");
  if (spaceIndex === -1) return { command: input.slice(1), args: "", argsStart: input.length };
  return {
    command: input.slice(1, spaceIndex),
    args: input.slice(spaceIndex + 1),
    argsStart: spaceIndex + 1,
  };
};

/** Extract the active argument token at the end of slash command args. */
export const activeArgumentToken = (slash: ParsedSlashInput): ActiveArgumentToken => {
  const beforeCursor = slash.args;
  // Final non-space token before the cursor, e.g. "--model" in "ask --model".
  const match = /(?:^|\s)(?<token>\S*)$/.exec(beforeCursor);
  const value = match?.groups?.token;
  const token = value === undefined ? "" : value;
  const start = slash.argsStart + beforeCursor.length - token.length;
  return { start, end: slash.argsStart + beforeCursor.length, value: token };
};

/** Split slash command args on whitespace. */
export const splitArgs = (input: string): string[] => {
  return input.trim().split(/\s+/).filter(Boolean);
};

/** Whether the args string ends with trailing whitespace. */
export const hasTrailingWhitespace = (input: string): boolean => {
  return /\s$/.test(input);
};
