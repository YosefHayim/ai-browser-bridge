export function readErrorMessage(error: unknown): string {
  const isError = error instanceof Error;
  if (isError) return error.message;
  return String(error);
}
