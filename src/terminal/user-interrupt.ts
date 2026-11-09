import { once } from "node:events";
import type { ExitCode } from "./cli-types.ts";

type StopStep = () => Promise<void>;

// Stop steps of the commands running now (ask, TUI). A Ctrl-C or kill runs them before the run ends.
const stopStepsOnInterrupt = new Set<StopStep>();

export const addStopOnInterrupt = (stopStep: StopStep): void => {
  stopStepsOnInterrupt.add(stopStep);
};

const waitForInterruptSignal = async (): Promise<void> => {
  await Promise.race([once(process, "SIGINT"), once(process, "SIGTERM")]);
};

// Runs one command. A Ctrl-C or kill runs the stop steps first, then the run ends with status 1
// whatever the command returns.
export const runUntilInterrupt = async (runCommand: () => Promise<ExitCode>): Promise<ExitCode> => {
  const interruption = { isRequested: false };
  const interruptedRun = async (): Promise<ExitCode> => {
    await waitForInterruptSignal();
    interruption.isRequested = true;
    for (const stopStep of stopStepsOnInterrupt) await stopStep();
    return 1;
  };
  const interruptedRunPromise = interruptedRun();

  const commandStatus = await Promise.race([runCommand(), interruptedRunPromise]);
  const isInterruptRequested = interruption.isRequested;
  if (isInterruptRequested) return interruptedRunPromise;
  return commandStatus;
};
