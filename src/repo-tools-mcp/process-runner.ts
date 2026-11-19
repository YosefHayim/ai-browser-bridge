import { type ChildProcess, spawn } from "node:child_process";

export const EMPTY_COMMAND_MESSAGE = "Empty command.";

const defaultTimeoutMilliseconds = 30_000;

export type ProcessExit = {
  stdout: string;
  stderr: string;
  code: number | null;
};

type RunProcessSettings = {
  timeoutMilliseconds?: number;
  stdin?: string;
};

type ProcessPrintouts = { stdout: string; stderr: string };

type SpawnProcessDetails = {
  command: string;
  commandArguments: string[];
  cwd: string;
  stdin?: string;
  timeoutMilliseconds: number;
};

export function runProcess(
  argumentList: readonly string[],
  cwd: string,
  settings: RunProcessSettings = {},
): Promise<ProcessExit> {
  const hasNoArgumentList = argumentList.length === 0;
  if (hasNoArgumentList) {
    return Promise.resolve({ stdout: "", stderr: EMPTY_COMMAND_MESSAGE, code: 1 });
  }

  const [command = "", ...commandArguments] = argumentList;
  const timeoutSettingMilliseconds = settings.timeoutMilliseconds;
  const isTimeoutMissing = timeoutSettingMilliseconds == null;
  const timeoutMilliseconds = isTimeoutMissing
    ? defaultTimeoutMilliseconds
    : timeoutSettingMilliseconds;

  return spawnProcess({
    command,
    commandArguments,
    cwd,
    stdin: settings.stdin,
    timeoutMilliseconds,
  });
}

function spawnProcess(details: SpawnProcessDetails): Promise<ProcessExit> {
  return new Promise((finish) => {
    const proc = spawn(details.command, details.commandArguments, { cwd: details.cwd });
    attachProcessListeners({ proc, timeoutMilliseconds: details.timeoutMilliseconds, finish });
    writeProcessStdin({ proc, stdin: details.stdin });
  });
}

function killProcess(proc: ChildProcess): void {
  proc.kill();
}

function attachProcessListeners(details: {
  proc: ChildProcess;
  timeoutMilliseconds: number;
  finish: (verdict: ProcessExit) => void;
}): void {
  const printouts: ProcessPrintouts = { stdout: "", stderr: "" };
  const timer = setTimeout(killProcess, details.timeoutMilliseconds, details.proc);

  attachProcessPrintout(details.proc, printouts);
  attachProcessCompletion({ proc: details.proc, timer, printouts, finish: details.finish });
}

function attachProcessPrintout(proc: ChildProcess, printouts: ProcessPrintouts): void {
  proc.stdout?.on("data", (chunk: Buffer) => {
    printouts.stdout += chunk.toString();
  });

  proc.stderr?.on("data", (chunk: Buffer) => {
    printouts.stderr += chunk.toString();
  });
}

function attachProcessCompletion(details: {
  proc: ChildProcess;
  timer: NodeJS.Timeout;
  printouts: ProcessPrintouts;
  finish: (verdict: ProcessExit) => void;
}): void {
  details.proc.on("close", (code) => {
    clearTimeout(details.timer);
    details.finish({ stdout: details.printouts.stdout, stderr: details.printouts.stderr, code });
  });

  details.proc.on("error", (error) => {
    clearTimeout(details.timer);
    details.finish({ stdout: details.printouts.stdout, stderr: error.message, code: 1 });
  });
}

function writeProcessStdin(details: { proc: ChildProcess; stdin?: string }): void {
  const isStdinMissing = details.stdin == null;
  if (isStdinMissing) return;

  details.proc.stdin?.write(details.stdin);
  details.proc.stdin?.end();
}
