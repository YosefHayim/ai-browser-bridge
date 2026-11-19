import { CommanderError } from "commander";
import { readErrorMessage } from "@/read-error-message.ts";
import type { ExitCode } from "@/terminal/cli/cli-types.ts";

const BAD_USAGE_EXIT_CODE = 2;

const BRIDGE_USAGE_CODE = "bridge.usage";

export function createUsageError(message: string): CommanderError {
  return new CommanderError(BAD_USAGE_EXIT_CODE, BRIDGE_USAGE_CODE, message);
}

function readCommanderExitCode(error: CommanderError): ExitCode {
  const isSuccessfulExit = error.exitCode === 0;
  if (isSuccessfulExit) return 0;

  // Commander prints its own help and option errors before it throws; only bridge usage errors are written here.
  const isBridgeUsageError = error.code === BRIDGE_USAGE_CODE;
  if (isBridgeUsageError) process.stderr.write(`${error.message}\n`);

  return BAD_USAGE_EXIT_CODE;
}

export function writeCliFailure(error: unknown): ExitCode {
  const isCommanderError = error instanceof CommanderError;
  if (isCommanderError) return readCommanderExitCode(error);

  process.stderr.write(`${readErrorMessage(error)}\n`);

  return 1;
}

export function fail(message: string): never {
  throw new Error(message);
}

export function failUsage(message: string): never {
  throw createUsageError(message);
}
