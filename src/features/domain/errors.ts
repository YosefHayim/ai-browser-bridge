/**
 * Shared guards for Node.js system errors.
 *
 * Filesystem and process calls reject with `NodeJS.ErrnoException` carrying a
 * string `code` like `"ENOENT"`. `catch` binds these as `unknown`; these guards
 * are the single place that narrowing lives.
 */

/** Narrow an unknown caught value to a Node.js system error with `.code`. */
export const isNodeError = (error: unknown): error is NodeJS.ErrnoException => {
  return error instanceof Error && "code" in error;
};

/** True when the caught value is a Node.js error with exactly this code. */
export const hasErrorCode = (error: unknown, code: string): boolean => {
  return isNodeError(error) && error.code === code;
};
