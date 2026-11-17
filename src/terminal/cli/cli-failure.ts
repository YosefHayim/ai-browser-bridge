import { CommanderError } from "commander";
import { readErrorMessage } from "@/read-error-message.ts";
import type { ExitCode } from "@/terminal/cli/cli-types.ts";

const BAD_USAGE_EXIT_CODE = 2;

const BRIDGE_USAGE_CODE = "bridge.usage";

export function createUsageError(message: string): CommanderError {
  return new CommanderError(BAD_USAGE_EXIT_CODE, BRIDGE_USAGE_CODE, message);
}

// Commander prints its own help, version and usage errors before it throws, so they are not written again.
export function writeCliFailure(error: unknown): ExitCode {
  const isCommanderExit = error instanceof CommanderError && error.code !== BRIDGE_USAGE_CODE;
  if (isCommanderExit) {
    const isSuccessfulExit = error.exitCode === 0;

    return isSuccessfulExit ? 0 : BAD_USAGE_EXIT_CODE;
  }

  process.stderr.write(`${readErrorMessage(error)}\n`);

  const isBadUsage = error instanceof CommanderError;
  if (isBadUsage) return BAD_USAGE_EXIT_CODE;

  return 1;
}

export function fail(message: string): never {
  throw new Error(message);
}

export function failUsage(message: string): never {
  throw createUsageError(message);
}
