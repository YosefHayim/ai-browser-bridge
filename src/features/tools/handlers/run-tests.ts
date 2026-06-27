import { z } from "zod";
import { isAllowedTestCommand, trimOutput } from "../sandbox.ts";
import type { ToolDef } from "../../domain/types.ts";
import { runProcess } from "./process.ts";

/** Run an allowed project test command. */
async function runTests(
  args: Record<string, unknown>,
): Promise<{ ok: boolean; output: string }> {
  const command = String(args.command);
  const repoRoot = String(args._repoRoot);
  const denied = validateTestCommand({ parts: command.trim().split(/\s+/), command });
  if (denied) return denied;
  return formatTestResult(await runProcess(command.trim().split(/\s+/), repoRoot, { timeoutMs: 120_000 }));
}

function validateTestCommand(input: { parts: string[]; command: string }): { ok: false; output: string } | null {
  if (input.parts.length === 0) return { ok: false, output: "Empty command." };
  if (!isAllowedTestCommand(input.parts)) {
    return {
      ok: false,
      output: `Command not allowlisted: ${input.command}\nAllowed: npm test, pnpm test, pytest, go test ./..., cargo test, make test`,
    };
  }
  return null;
}

function formatTestResult(result: { stdout: string; stderr: string; code: number | null }): { ok: boolean; output: string } {
  const combined = result.stdout + "\n" + result.stderr;
  return { ok: result.code === 0, output: trimOutput(combined.trim()) };
}

export const runTestsTool: ToolDef = {
  name: "run_tests",
  description: "Run an allowed project test command (npm test, pytest, go test, etc.).",
  annotations: {
    title: "Run tests",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  parameters: {
    command: z.string().describe("Allowed test command, e.g. 'npm test' or 'pytest'."),
  },
  handler: runTests,
};
