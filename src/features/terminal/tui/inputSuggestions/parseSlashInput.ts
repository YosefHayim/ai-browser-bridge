import type { ActiveArgumentToken, ParsedSlashInput } from "./types.ts";

/**
 * Parse a slash-command input string into command name and args.
 *
 * @param input - Input values for the operation.
 * @returns The `parseSlashInput` result.
 * @example
 * ```ts
 * const result = parseSlashInput(input);
 * ```
 */
export const parseSlashInput = (input: string): ParsedSlashInput | null => {
  if (!input.startsWith("/")) return null;
  const spaceIndex = input.indexOf(" ");
  if (spaceIndex === -1) return { command: input.slice(1), args: "", argsStart: input.length };
  return {
    command: input.slice(1, spaceIndex),
    args: input.slice(spaceIndex + 1),
    argsStart: spaceIndex + 1,
  };
};

/**
 * Extract the active argument token at the end of slash command args.
 *
 * @param slash - Slash value.
 * @returns The `activeArgumentToken` result.
 * @example
 * ```ts
 * const result = activeArgumentToken(slash);
 * ```
 */
export const activeArgumentToken = (slash: ParsedSlashInput): ActiveArgumentToken => {
  const beforeCursor = slash.args;
  const match = /(?:^|\s)(\S*)$/.exec(beforeCursor);
  const value = match?.[1] ?? "";
  const start = slash.argsStart + beforeCursor.length - value.length;
  return { start, end: slash.argsStart + beforeCursor.length, value };
};

/**
 * Split slash command args on whitespace.
 *
 * @param input - Input values for the operation.
 * @returns The `splitArgs` result.
 * @example
 * ```ts
 * const result = splitArgs(input);
 * ```
 */
export const splitArgs = (input: string): string[] => {
  return input.trim().split(/\s+/).filter(Boolean);
};

/**
 * Whether the args string ends with trailing whitespace.
 *
 * @param input - Input values for the operation.
 * @returns Whether the condition matches.
 * @example
 * ```ts
 * const result = hasTrailingWhitespace(input);
 * ```
 */
export const hasTrailingWhitespace = (input: string): boolean => {
  return /\s$/.test(input);
};
