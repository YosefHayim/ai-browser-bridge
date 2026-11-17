import { once } from "node:events";
import type { ExitCode } from "@/terminal/cli/cli-types.ts";

type StopStep = () => Promise<void>;

const stopStepsOnInterrupt = new Set<StopStep>();

export function addStopOnInterrupt(stopStep: StopStep): void {
  stopStepsOnInterrupt.add(stopStep);
}

async function waitForInterruptSignal(commandEnded: AbortSignal): Promise<void> {
  await Promise.race([
    once(process, "SIGINT", { signal: commandEnded }),
    once(process, "SIGTERM", { signal: commandEnded }),
  ]);
}

export async function runUntilInterrupt(runCommand: () => Promise<ExitCode>): Promise<ExitCode> {
  const commandEnded = new AbortController();
  const interruption = { isRequested: false };
  async function readInterruptedRun(): Promise<ExitCode> {
    await waitForInterruptSignal(commandEnded.signal);
    interruption.isRequested = true;
    // A copy, because the command's finally may clear the set while these steps run.

    const stopStepsToRun = [...stopStepsOnInterrupt];

    for (const stopStep of stopStepsToRun) await stopStep();

    return 1;
  }
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
}
