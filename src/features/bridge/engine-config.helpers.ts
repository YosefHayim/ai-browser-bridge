import { execFile } from "node:child_process";
import type { StartEngineOptions } from "./engine.types.ts";

/** Resolve the repo's current git branch, or undefined when not a git repo. */
export function currentGitBranch(repoPath: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoPath }, gitBranchCallback(resolve));
  });
}

/** Git execFile callback input. */
interface GitBranchCallbackInput {
  error: Error | null;
  stdout: string;
}

/** Resolve branch name from git execFile callback input. */
function resolveGitBranch(input: GitBranchCallbackInput): string | undefined {
  return input.error ? undefined : input.stdout.trim() || undefined;
}

/** Build git execFile callback that resolves branch name or undefined. */
function gitBranchCallback(resolve: (value: string | undefined) => void) {
  return (...args: [Error | null, string]) => resolve(resolveGitBranch({ error: args[0], stdout: args[1] }));
}

/** Default stderr logger used when no custom log sink is provided. */
export function defaultEngineLog(line: string): void {
  process.stderr.write(`${line}\n`);
}

/** Resolve the diagnostics log sink from start options. */
export function resolveEngineLog(options: StartEngineOptions): (line: string) => void {
  return options.log ?? defaultEngineLog;
}

/** Context for logging hook configuration warnings. */
export interface LogHookWarningsContext {
  /** Hook configuration errors to log. */
  errors: string[];
  /** Diagnostics log sink. */
  log: (line: string) => void;
}

/** Log hook configuration warnings without failing boot. */
export function logHookWarnings(ctx: LogHookWarningsContext): void {
  for (const error of ctx.errors) ctx.log(`Hooks warning: ${error}`);
}
