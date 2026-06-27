import { spawn, type ChildProcess } from "node:child_process";
import type { ProcessResult } from "./process.ts";

interface SpawnProcessInput {
  command: string;
  args: string[];
  cwd: string;
  stdin?: string;
  timeoutMs: number;
}

/** Spawn a subprocess and resolve when it exits or times out. */
export function spawnProcess(input: SpawnProcessInput): Promise<ProcessResult> {
  return new Promise((done) => {
    const proc = spawn(input.command, input.args, { cwd: input.cwd });
    attachProcessListeners({ proc, timeoutMs: input.timeoutMs, done });
    writeProcessStdin({ proc, stdin: input.stdin });
  });
}

interface AttachListenersInput {
  proc: ChildProcess;
  timeoutMs: number;
  done: (result: ProcessResult) => void;
}

function attachProcessListeners(input: AttachListenersInput): void {
  const output = { stdout: "", stderr: "" };
  const timer = setTimeout(() => { input.proc.kill(); }, input.timeoutMs);
  attachProcessOutput({ proc: input.proc, output });
  attachProcessCompletion({ proc: input.proc, timer, output, done: input.done });
}

function attachProcessOutput(input: { proc: ChildProcess; output: { stdout: string; stderr: string } }): void {
  input.proc.stdout?.on("data", (chunk: Buffer) => { input.output.stdout += chunk.toString(); });
  input.proc.stderr?.on("data", (chunk: Buffer) => { input.output.stderr += chunk.toString(); });
}

function attachProcessCompletion(input: {
  proc: ChildProcess;
  timer: NodeJS.Timeout;
  output: { stdout: string; stderr: string };
  done: (result: ProcessResult) => void;
}): void {
  input.proc.on("close", (code) => {
    clearTimeout(input.timer);
    input.done({ stdout: input.output.stdout, stderr: input.output.stderr, code });
  });
  input.proc.on("error", (err) => {
    clearTimeout(input.timer);
    input.done({ stdout: input.output.stdout, stderr: err.message, code: 1 });
  });
}

function writeProcessStdin(input: { proc: ChildProcess; stdin?: string }): void {
  if (input.stdin === undefined) return;
  input.proc.stdin?.write(input.stdin);
  input.proc.stdin?.end();
}
