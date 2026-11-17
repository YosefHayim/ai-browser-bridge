function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export function hasErrorCode(error: unknown, code: string): boolean {
  return isNodeError(error) && error.code === code;
}
