import { once } from "node:events";
import type { ExitCode } from "./cli-types.ts";

type StopStep = () => Promise<void>;

const stopStepsOnInterrupt = new Set<StopStep>();

export const addStopOnInterrupt = (stopStep: StopStep): void => {
  stopStepsOnInterrupt.add(stopStep);
};

const waitForInterruptSignal = async (commandEnded: AbortSignal): Promise<void> => {
  await Promise.race([
    once(process, "SIGINT", { signal: commandEnded }),
    once(process, "SIGTERM", { signal: commandEnded }),
  ]);
};

export const runUntilInterrupt = async (runCommand: () => Promise<ExitCode>): Promise<ExitCode> => {
  const commandEnded = new AbortController();
  const interruption = { isRequested: false };
  const readInterruptedRun = async (): Promise<ExitCode> => {
    await waitForInterruptSignal(commandEnded.signal);
    interruption.isRequested = true;
    // A copy, because the command's finally may clear the set while these steps run.

    const stopStepsToRun = [...stopStepsOnInterrupt];

    for (const stopStep of stopStepsToRun) await stopStep();

    return 1;
  };
  const interruptedRunPromise = readInterruptedRun();

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
