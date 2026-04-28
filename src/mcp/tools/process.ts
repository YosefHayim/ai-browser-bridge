import { spawn } from "node:child_process";

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
  return new Promise((resolve) => {
    if (args.length === 0) {
      resolve({ stdout: "", stderr: "Empty command.", code: 1 });
      return;
    }

    const [command, ...rest] = args;
    const proc = spawn(command, rest, { cwd });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => { proc.kill(); }, options.timeoutMs ?? 30_000);

    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    proc.on("close", (code) => { clearTimeout(timer); resolve({ stdout, stderr, code }); });
    proc.on("error", (err) => { clearTimeout(timer); resolve({ stdout, stderr: err.message, code: 1 }); });

    if (options.stdin !== undefined) {
      proc.stdin.write(options.stdin);
      proc.stdin.end();
    }
  });
}
