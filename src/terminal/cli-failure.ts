export const cliFailureMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return String(error);
};

export const writeCliFailure = (error: unknown): never => {
  process.stderr.write(`${cliFailureMessage(error)}\n`);
  process.exit(1);
};
