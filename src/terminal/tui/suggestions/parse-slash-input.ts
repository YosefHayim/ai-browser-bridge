import type { ActiveArgumentToken, ParsedSlashLine } from "./types.ts";

export const parseSlashLine = (details: string): ParsedSlashLine | null => {
  const isNotSlashCommand = !details.startsWith("/");
  if (isNotSlashCommand) return null;

  const spaceIndex = details.indexOf(" ");
  const isSpaceNotFound = spaceIndex === -1;
  if (isSpaceNotFound) return { command: details.slice(1), args: "", argsStart: details.length };

  return {
    command: details.slice(1, spaceIndex),
    args: details.slice(spaceIndex + 1),
    argsStart: spaceIndex + 1,
  };
};

export const readActiveArgumentToken = (slash: ParsedSlashLine): ActiveArgumentToken => {
  const beforeCursor = slash.args;
  // Final non-space token before the cursor, e.g. "--model" in "ask --model".
  const hit = /(?:^|\s)(?<token>\S*)$/.exec(beforeCursor);
  const tokenGroup = hit?.groups?.token;
  const isTokenGroupMissing = tokenGroup == null;
  const token = isTokenGroupMissing ? "" : tokenGroup;
  const start = slash.argsStart + beforeCursor.length - token.length;
  return { start, end: slash.argsStart + beforeCursor.length, value: token };
};

export const splitArgumentList = (details: string): string[] => {
  return details
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
};

export const hasTrailingWhitespace = (details: string): boolean => {
  return /\s$/.test(details);
};
