import type { ToolReport } from "@/message-types.ts";
import {
  EMPTY_COMMAND_MESSAGE,
  type ProcessExit,
  runProcess,
} from "@/repo-tools-mcp/process-runner.ts";
import { RunTestsArgumentListSchema } from "@/repo-tools-mcp/tools-schemas.ts";
import { trimPrintout } from "@/repo-tools-mcp/trim-printout.ts";
import type { ToolDef } from "@/tool-types.ts";

const SPACE = " ";

const testTimeoutMilliseconds = 120_000;

// Only these argv prefixes may run under run_tests (no shell).
const ALLOWED_TEST_PREFIXES: string[][] = [
  ["npm", "test"],
  ["npm", "run", "test"],
  ["pnpm", "test"],
  ["pnpm", "run", "test"],
  ["yarn", "test"],
  ["pytest"],
  ["python", "-m", "pytest"],
  ["go", "test"],
  ["cargo", "test"],
  ["make", "test"],
];

export function isAllowedTestCommand(parts: string[]): boolean {
  for (const prefix of ALLOWED_TEST_PREFIXES) {
    const leadingParts = parts.slice(0, prefix.length);
    const isPrefixMatch = leadingParts.join(SPACE) === prefix.join(SPACE);
    if (isPrefixMatch) return true;
  }

  return false;
}

function findDeniedTestCommand(parts: string[], command: string): ToolReport | null {
  const isPartsEmpty = parts.length === 0;
  if (isPartsEmpty) return { ok: false, output: EMPTY_COMMAND_MESSAGE };

  const isNotAllowed = !isAllowedTestCommand(parts);
  if (isNotAllowed) {
    return {
      ok: false,
      output: `Command not allowlisted: ${command}\nAllowed: npm test, pnpm test, pytest, go test ./..., cargo test, make test`,
    };
  }

  return null;
}

function createToolReportFromTests(verdict: ProcessExit): ToolReport {
  const combinedPrintout = `${verdict.stdout}\n${verdict.stderr}`;
  const trimmedPrintout = combinedPrintout.trim();

  return { ok: verdict.code === 0, output: trimPrintout(trimmedPrintout) };
}

async function runTests(argumentList: Record<string, unknown>): Promise<ToolReport> {
  const command = String(argumentList.command);
  const repoRoot = String(argumentList._repoRoot);
  // Split the command on any run of whitespace.
  const parts = command.trim().split(/\s+/);
  const denied = findDeniedTestCommand(parts, command);

  const isCommandDenied = denied != null;
  if (isCommandDenied) return denied;

  const verdict = await runProcess(parts, repoRoot, {
    timeoutMilliseconds: testTimeoutMilliseconds,
  });

  return createToolReportFromTests(verdict);
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
  argsSchema: RunTestsArgumentListSchema,
  handler: runTests,
};
