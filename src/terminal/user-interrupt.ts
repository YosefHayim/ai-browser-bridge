import { once } from "node:events";
import type { ExitCode } from "./cli-types.ts";

type StopStep = () => Promise<void>;

// Stop steps of the commands running now (ask, TUI). A Ctrl-C or kill runs them before the run ends.
const stopStepsOnInterrupt = new Set<StopStep>();

export const addStopOnInterrupt = (stopStep: StopStep): void => {
  stopStepsOnInterrupt.add(stopStep);
};

// The signal listeners are removed when commandEnded aborts. That abort rejects this wait,
// which is handled by the Promise.race in runUntilInterrupt.
const waitForInterruptSignal = async (commandEnded: AbortSignal): Promise<void> => {
  await Promise.race([
    once(process, "SIGINT", { signal: commandEnded }),
    once(process, "SIGTERM", { signal: commandEnded }),
  ]);
};

// Runs one command. A Ctrl-C or kill runs the stop steps first, then the run ends with status 1
// whatever the command returns.
export const runUntilInterrupt = async (runCommand: () => Promise<ExitCode>): Promise<ExitCode> => {
  const commandEnded = new AbortController();
  const interruption = { isRequested: false };
  const interruptedRun = async (): Promise<ExitCode> => {
    await waitForInterruptSignal(commandEnded.signal);
    interruption.isRequested = true;
    // A copy, because the command's finally may clear the set while these steps run.
    const stopStepsToRun = [...stopStepsOnInterrupt];
    for (const stopStep of stopStepsToRun) await stopStep();
    return 1;
  };
  const interruptedRunPromise = interruptedRun();

  try {
    const commandStatus = await Promise.race([runCommand(), interruptedRunPromise]);

    const isInterruptRequested = interruption.isRequested;
    if (isInterruptRequested) return interruptedRunPromise;

    return commandStatus;
  } finally {
    commandEnded.abort();
    stopStepsOnInterrupt.clear();
  }
};
