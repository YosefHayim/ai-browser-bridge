/**
 * Shared guards for Node.js system errors.
 *
 * Filesystem and process calls reject with `NodeJS.ErrnoException` — an `Error`
 * carrying a string `code` like `"ENOENT"`. `catch` binds these as `unknown`, so
 * every caller that wants to branch on the code first has to narrow the value.
 * These guards are the single place that narrowing lives, replacing the
 * hand-rolled copies that previously sat in each fs-touching module.
 */

/**
 * Narrow an unknown caught value to a Node.js system error.
 *
 * Use when you need the typed `.code`/`.errno`/`.path` fields after the check,
 * e.g. `if (isNodeError(error) && error.code === "ENOENT") ...`.
 */
export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

/**
 * Predicate for "this caught value is a Node.js error with exactly this code".
 *
 * The boolean shortcut for the common `ENOENT`-style branch where the narrowed
 * error object itself is not needed afterwards.
 */
export function hasErrorCode(error: unknown, code: string): boolean {
  return isNodeError(error) && error.code === code;
}
