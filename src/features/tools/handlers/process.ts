import { spawnProcess } from "./process.spawn.ts";

export interface ProcessResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

interface RunProcessOptions {
  timeoutMs?: number;
  stdin?: string;
}

/** Run a subprocess without a shell and capture stdout/stderr. */
export function runProcess(
  args: readonly string[],
  cwd: string,
  options: RunProcessOptions = {},
): Promise<ProcessResult> {
  if (args.length === 0) return Promise.resolve({ stdout: "", stderr: "Empty command.", code: 1 });
  const [command, ...rest] = args;
  return spawnProcess({
    command,
    args: rest,
    cwd,
    stdin: options.stdin,
    timeoutMs: options.timeoutMs ?? 30_000,
  });
}
