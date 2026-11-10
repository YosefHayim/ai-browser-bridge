import { CommanderError } from "commander";
import type { ExitCode } from "./cli-types.ts";

const BRIDGE_USAGE_CODE = "bridge.usage";

export const createUsageError = (message: string): CommanderError => {
  return new CommanderError(2, BRIDGE_USAGE_CODE, message);
};

export const readCliFailureMessage = (error: unknown): string => {
  const isErrorObject = error instanceof Error;
  if (isErrorObject) return error.message;

  return String(error);
};

// Commander prints its own help, version and usage errors before it throws, so they are not written again.
export const writeCliFailure = (error: unknown): ExitCode => {
  const isCommanderExit = error instanceof CommanderError && error.code !== BRIDGE_USAGE_CODE;
  if (isCommanderExit) {
    const isSuccessfulExit = error.exitCode === 0;

    return isSuccessfulExit ? 0 : 2;
  }

  process.stderr.write(`${readCliFailureMessage(error)}\n`);

  const isBadUsage = error instanceof CommanderError;
  if (isBadUsage) return 2;

  return 1;
};
