export const exitWithCliError = (error: unknown): never => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

// Wait for pipe writes before a command exits.
export const writeStdout = (text: string): Promise<void> => {
  return new Promise((resolveWrite) => {
    process.stdout.write(text, () => resolveWrite());
  });
};
