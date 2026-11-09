/**
 * Shared guards for Node.js system errors.
 *
 * Filesystem and process calls reject with `NodeJS.ErrnoException` carrying a
 * string `code` like `"ENOENT"`. `catch` binds these as `unknown`; these guards
 * are the single place that narrowing lives.
 */

export const isNodeError = (error: unknown): error is NodeJS.ErrnoException => {
  return error instanceof Error && "code" in error;
};

export const hasErrorCode = (error: unknown, code: string): boolean => {
  return isNodeError(error) && error.code === code;
};
