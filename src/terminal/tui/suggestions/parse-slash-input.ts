import type { ActiveArgumentToken, ParsedSlashInput } from "./types.ts";

export const parseSlashInput = (input: string): ParsedSlashInput | undefined => {
  const isNotSlashCommand = !input.startsWith("/");
  if (isNotSlashCommand) return undefined;

  const spaceIndex = input.indexOf(" ");
  const isSpaceNotFound = spaceIndex === -1;
  if (isSpaceNotFound) return { command: input.slice(1), args: "", argsStart: input.length };

  return {
    command: input.slice(1, spaceIndex),
    args: input.slice(spaceIndex + 1),
    argsStart: spaceIndex + 1,
  };
};

export const activeArgumentToken = (slash: ParsedSlashInput): ActiveArgumentToken => {
  const beforeCursor = slash.args;
  // Final non-space token before the cursor, e.g. "--model" in "ask --model".
  const match = /(?:^|\s)(?<token>\S*)$/.exec(beforeCursor);
  const tokenGroup = match?.groups?.token;
  const isTokenGroupMissing = tokenGroup === undefined;
  const token = isTokenGroupMissing ? "" : tokenGroup;
  const start = slash.argsStart + beforeCursor.length - token.length;
  return { start, end: slash.argsStart + beforeCursor.length, value: token };
};

export const splitArgs = (input: string): string[] => {
  return input
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
};

export const hasTrailingWhitespace = (input: string): boolean => {
  return /\s$/.test(input);
};
