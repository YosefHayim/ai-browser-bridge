import { execFile } from "node:child_process";

/** Fatal error helper: write to stderr and exit non-zero. */
export function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/** Redirect console.log to stderr so stdout stays machine-readable. */
export function redirectConsoleToStderr(): void {
  console.log = (...args: unknown[]) => console.error(...args);
}

/**
 * Convert a CLI `--timeout <seconds>` string to milliseconds for the engine.
 * Returns undefined for absent/empty/NaN/non-positive input so the browser
 * layer falls back to its default wait.
 */
export function timeoutMsFromSeconds(seconds: string | undefined): number | undefined {
  if (!seconds) return undefined;
  const parsed = Number(seconds);
  if (Number.isNaN(parsed) || parsed <= 0) return undefined;
  return Math.round(parsed * 1000);
}

/**
 * Stop the in-flight ChatGPT turn, tear the engine down, then exit. Used by the
 * headless signal handlers so a Ctrl-C / kill clicks "Stop generating" before
 * dropping the process — otherwise ChatGPT keeps generating server-side in the
 * warm tab and burns Plus quota on a reply nobody captures.
 */
export async function abortAndExit(
  engine: { abort(): Promise<void>; shutdown(opts?: { closeBrowser?: boolean }): Promise<void> },
  code: number,
  exit: (code: number) => never,
): Promise<void> {
  await engine.abort().catch(() => {});
  await engine.shutdown({ closeBrowser: false }).catch(() => {});
  exit(code);
}

import { listSessions } from "../../store/session-store.ts";

/** Print stored bridge sessions (newest first) as JSON. */
export async function runSessions(): Promise<void> {
  const sessions = await listSessions();
  process.stdout.write(`${JSON.stringify(sessions, null, 2)}\n`);
  process.exit(0);
}

/** Kill whatever process is listening on the Chrome debug port (macOS `lsof`). */
export function killDebugPort(port: number): Promise<boolean> {
  return new Promise((resolveKill) => {
    execFile("lsof", ["-ti", `tcp:${port}`], (...args: [Error | null, string]) => {
      resolveKill(killPidsFromStdout(args[1]));
    });
  });
}

/** Parse lsof stdout and kill each pid (best-effort). */
function killPidsFromStdout(stdout: string): boolean {
  const pids = stdout.trim().split(/\s+/).filter(Boolean);
  if (pids.length === 0) return false;
  for (const pid of pids) killPidBestEffort(pid);
  return true;
}

/** Kill one pid, ignoring errors when the process is already gone. */
function killPidBestEffort(pid: string): void {
  try {
    process.kill(Number(pid));
  } catch {
    // process already gone
  }
}
