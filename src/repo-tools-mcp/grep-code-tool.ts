import type { ToolReport } from "@/message-types.ts";
import { readRepositoryPath } from "@/repo-files/paths.ts";
import { type ProcessExit, runProcess } from "@/repo-tools-mcp/process-runner.ts";
import { GrepCodeArgumentListSchema } from "@/repo-tools-mcp/tools-schemas.ts";
import { trimPrintout } from "@/repo-tools-mcp/trim-printout.ts";
import type { ToolDef } from "@/tool-types.ts";

const GLOB_ARGUMENT_FLAG = "--glob";

const grepTimeoutMilliseconds = 20_000;

type GrepDetails = {
  pattern: string;
  safePath: string;
  glob: string | null;
  repoRoot: string;
};

function listRipgrepArgumentList(details: GrepDetails): string[] {
  const argumentList = [
    "rg",
    "--line-number",
    "--hidden",
    GLOB_ARGUMENT_FLAG,
    "!.git",
    GLOB_ARGUMENT_FLAG,
    "!node_modules",
    GLOB_ARGUMENT_FLAG,
    "!dist",
    GLOB_ARGUMENT_FLAG,
    "!build",
  ];

  const detailsGlob = details.glob;
  const hasDetailsGlob = detailsGlob != null;
  if (hasDetailsGlob) argumentList.push(GLOB_ARGUMENT_FLAG, detailsGlob);

  argumentList.push(details.pattern, details.safePath);
  return argumentList;
}

function createToolReportFromGrep(verdict: ProcessExit): ToolReport {
  const isGrepFoundNothing = verdict.code === 1;
  if (isGrepFoundNothing) return { ok: true, output: "" };

  const isGrepFailed = verdict.code !== 0;
  if (isGrepFailed) return { ok: false, output: verdict.stderr };

  return { ok: true, output: trimPrintout(verdict.stdout) };
}

function readGrepDetails(argumentList: Record<string, unknown>): GrepDetails {
  const repoRoot = String(argumentList._repoRoot);
  const isGlobGiven = argumentList.glob != null;
  const glob = isGlobGiven ? String(argumentList.glob) : null;
  const safePath = readRepositoryPath(repoRoot, String(argumentList.path));

  return { pattern: String(argumentList.pattern), safePath, glob, repoRoot };
}

async function searchRepository(argumentList: Record<string, unknown>): Promise<ToolReport> {
  const details = readGrepDetails(argumentList);
  const ripgrepArgumentList = listRipgrepArgumentList(details);
  const ripgrepProcess = await runProcess(ripgrepArgumentList, details.repoRoot, {
    timeoutMilliseconds: grepTimeoutMilliseconds,
  });

  return createToolReportFromGrep(ripgrepProcess);
}

export const grepTool: ToolDef = {
  name: "grep_code",
  description:
    "Search the repository using ripgrep. Locate symbols, imports, routes, tests, configs, and references.",
  annotations: { title: "Search repo", readOnlyHint: true, openWorldHint: false },
  argsSchema: GrepCodeArgumentListSchema,
  handler: searchRepository,
};
