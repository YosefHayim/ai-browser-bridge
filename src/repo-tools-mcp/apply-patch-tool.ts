import { createCheckpoint } from "@/checkpoints/checkpoints.ts";
import type { ToolReport } from "@/message-types.ts";
import { readErrorMessage } from "@/read-error-message.ts";
import { readRepositoryPath } from "@/repo-files/paths.ts";
import { type ProcessExit, runProcess } from "@/repo-tools-mcp/process-runner.ts";
import { ApplyPatchArgumentListSchema } from "@/repo-tools-mcp/tools-schemas.ts";
import { trimPrintout } from "@/repo-tools-mcp/trim-printout.ts";
import type { ToolDef } from "@/tool-types.ts";

const STDIN_ARGUMENT = "-";

const APPLY_ARGUMENT = "apply";

const GIT_COMMAND = "git";

const APPLY_PATCH_TOOL_NAME = "apply_patch";

const applyTimeoutMilliseconds = 20_000;

// Matches "diff --git a/<old> b/<new>" and captures both paths.
const GIT_DIFF_HEADER = /^diff --git a\/(?<oldPath>.+?) b\/(?<newPath>.+)$/;

// Matches "--- a/<path>" or "+++ b/<path>" and captures the path.
const GIT_FILE_MARKER = /^(?:---|\+\+\+) (?:a|b)\/(?<filePath>.+)$/;

// Matches one line break, Windows or Unix.
const LINE_BREAK = /\r?\n/;

type ApplyPatchDetails = {
  patch: string;
  repoRoot: string;
  patchPaths: string[];
};

function readFailureMessage(verdict: ProcessExit): string {
  const isStderrNotEmpty = verdict.stderr.length > 0;
  if (isStderrNotEmpty) return verdict.stderr;

  return verdict.stdout;
}

async function runGitApply(details: ApplyPatchDetails): Promise<ToolReport> {
  const checkProcess = await runProcess(
    [GIT_COMMAND, APPLY_ARGUMENT, "--check", STDIN_ARGUMENT],
    details.repoRoot,
    { stdin: details.patch, timeoutMilliseconds: applyTimeoutMilliseconds },
  );

  const isCheckFailed = checkProcess.code !== 0;
  if (isCheckFailed) {
    const checkFailure = readFailureMessage(checkProcess);
    return { ok: false, output: `Patch check failed:\n${trimPrintout(checkFailure)}` };
  }

  const applyProcess = await runProcess(
    [GIT_COMMAND, APPLY_ARGUMENT, STDIN_ARGUMENT],
    details.repoRoot,
    {
      stdin: details.patch,
      timeoutMilliseconds: applyTimeoutMilliseconds,
    },
  );

  const isApplyFailed = applyProcess.code !== 0;
  if (isApplyFailed) {
    const applyFailure = readFailureMessage(applyProcess);
    return { ok: false, output: `Patch apply failed:\n${trimPrintout(applyFailure)}` };
  }

  return { ok: true, output: "Patch applied successfully." };
}

async function createPatchCheckpointNote(details: ApplyPatchDetails): Promise<string> {
  const isPatchPathsEmpty = details.patchPaths.length === 0;
  if (isPatchPathsEmpty) return "";

  try {
    const before = await createCheckpoint({
      repoRoot: details.repoRoot,
      paths: details.patchPaths,
      phase: "before",
      label: APPLY_PATCH_TOOL_NAME,
    });
    const after = await createCheckpoint({
      repoRoot: details.repoRoot,
      paths: details.patchPaths,
      phase: "after",
      label: APPLY_PATCH_TOOL_NAME,
    });
    return `\nCheckpoints:\n- before: ${before.id}\n- after: ${after.id}`;
  } catch (error) {
    return `\nCheckpoints failed: ${readErrorMessage(error)}`;
  }
}

async function applyPatch(argumentList: Record<string, unknown>): Promise<ToolReport> {
  const patch = String(argumentList.patch);
  const repoRoot = String(argumentList._repoRoot);
  readRepositoryPath(repoRoot, ".");
  const patchPaths = extractPatchPaths(patch);
  const details = { patch, repoRoot, patchPaths };
  const applied = await runGitApply(details);

  const isApplyFailed = !applied.ok;
  if (isApplyFailed) return applied;

  const checkpointNote = await createPatchCheckpointNote(details);

  return { ok: true, output: applied.output + checkpointNote };
}

export function extractPatchPaths(patch: string): string[] {
  const paths = new Set<string>();
  for (const line of patch.split(LINE_BREAK)) {
    const gitPaths = GIT_DIFF_HEADER.exec(line)?.groups;

    const hasGitPaths = gitPaths != null;
    if (hasGitPaths) {
      addPatchPath(paths, gitPaths.oldPath);
      addPatchPath(paths, gitPaths.newPath);
      continue;
    }

    const filePath = GIT_FILE_MARKER.exec(line)?.groups?.filePath;
    addPatchPath(paths, filePath);
  }
  return [...paths];
}

function addPatchPath(paths: Set<string>, path: string | undefined): void {
  const isPathMissing = path == null;
  if (isPathMissing) return;

  const trimmedPath = path.trim();
  const isPathEmpty = trimmedPath.length === 0;
  if (isPathEmpty) return;

  const isDevNull = trimmedPath === "/dev/null";
  if (isDevNull) return;

  paths.add(trimmedPath);
}

export const applyPatchTool: ToolDef = {
  name: APPLY_PATCH_TOOL_NAME,
  description:
    "Apply a unified diff patch to the repository. Use only after reading the relevant files.",
  annotations: {
    title: "Apply patch",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  argsSchema: ApplyPatchArgumentListSchema,
  handler: applyPatch,
};
