/**
 * Shared guards for Node.js system errors.
 *
 * Filesystem and process calls reject with `NodeJS.ErrnoException` — an `Error`
 * carrying a string `code` like `"ENOENT"`. `catch` binds these as `unknown`, so
 * every caller that wants to branch on the code first has to narrow the value.
 * These guards are the single place that narrowing lives, replacing the
 * hand-rolled copies that previously sat in each fs-touching module.
 */

import { Data } from "effect";

/**
 * Effect-native tagged error for wrapping Node.js system errors.
 *
 * @param error - The original caught error value.
 * @param code - Optional `errno` code string (e.g. `"ENOENT"`).
 */
export class NodeError extends Data.TaggedError("NodeError")<{
  readonly error: unknown;
  readonly code?: string;
}> {}

/**
 * Narrow an unknown caught value to a Node.js system error.
 *
 * Use when you need the typed `.code`/`.errno`/`.path` fields after the check,
 * e.g. `if (isNodeError(error) && error.code === "ENOENT") ...`.
 *
 * @param error - The unknown caught value.
 * @returns Whether the value is a NodeJS.ErrnoException.
 */
export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

/**
 * Predicate for "this caught value is a Node.js error with exactly this code".
 *
 * The boolean shortcut for the common `ENOENT`-style branch where the narrowed
 * error object itself is not needed afterwards.
 *
 * @param error - The unknown caught value.
 * @param code - The expected error code to match.
 * @returns Whether the value is a Node.js error with the given code.
 */
export function hasErrorCode(error: unknown, code: string): boolean {
  return isNodeError(error) && error.code === code;
}
