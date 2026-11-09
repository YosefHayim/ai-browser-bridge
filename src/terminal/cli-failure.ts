import { CommanderError } from "commander";
import type { ExitCode } from "./cli-types.ts";

// Our own bad-usage errors. Commander's usage errors use its own codes and are printed by Commander.
const BRIDGE_USAGE_CODE = "bridge.usage";

export const createUsageError = (message: string): CommanderError => {
  return new CommanderError(2, BRIDGE_USAGE_CODE, message);
};

export const cliFailureMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return String(error);
};

// Commander prints its own help, version and usage errors before it throws, so they are not written again.
export const writeCliFailure = (error: unknown): ExitCode => {
  const isCommanderExit = error instanceof CommanderError && error.code !== BRIDGE_USAGE_CODE;
  if (isCommanderExit) return error.exitCode === 0 ? 0 : 2;

  process.stderr.write(`${cliFailureMessage(error)}\n`);
  const isBadUsage = error instanceof CommanderError;
  if (isBadUsage) return 2;
  return 1;
};
