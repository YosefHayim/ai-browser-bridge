import { z } from "zod";
import { isAllowedTestCommand, trimOutput } from "../sandbox.ts";
import type { ToolDef } from "../../types/types.ts";
import { runProcess } from "./process.ts";

/** Run an allowed project test command. */
async function runTests(
  args: Record<string, unknown>,
): Promise<{ ok: boolean; output: string }> {
  const command = String(args.command);
  const repoRoot = String(args._repoRoot);

  const parts = command.trim().split(/\s+/);
  if (parts.length === 0) {
    return { ok: false, output: "Empty command." };
  }

  if (!isAllowedTestCommand(parts)) {
    return {
      ok: false,
      output: `Command not allowlisted: ${command}\nAllowed: npm test, pnpm test, pytest, go test ./..., cargo test, make test`,
    };
  }

  const result = await runProcess(parts, repoRoot, { timeoutMs: 120_000 });

  const combined = result.stdout + "\n" + result.stderr;
  return {
    ok: result.code === 0,
    output: trimOutput(combined.trim()),
  };
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
