import { trimOutput } from "../sandbox.ts";
import { createCheckpoint } from "../../store/checkpoints.ts";
import { runProcess } from "./process.ts";

/** Inputs for applying a git patch after the dry-run check passes. */
export interface ApplyPatchInput {
  patch: string;
  repoRoot: string;
  patchPaths: string[];
}

/** Dry-run and apply a unified diff via git apply. */
export async function runGitApply(input: ApplyPatchInput): Promise<{ ok: boolean; output: string }> {
  const check = await runProcess(
    ["git", "apply", "--check", "-"],
    input.repoRoot,
    { stdin: input.patch, timeoutMs: 20_000 },
  );
  if (check.code !== 0) {
    return { ok: false, output: `Patch check failed:\n${trimOutput(check.stderr || check.stdout)}` };
  }
  const applied = await runProcess(
    ["git", "apply", "-"],
    input.repoRoot,
    { stdin: input.patch, timeoutMs: 20_000 },
  );
  if (applied.code !== 0) {
    return { ok: false, output: `Patch apply failed:\n${trimOutput(applied.stderr || applied.stdout)}` };
  }
  return { ok: true, output: "Patch applied successfully." };
}

/** Create before/after checkpoints for patched paths when any exist. */
export async function createPatchCheckpoints(input: ApplyPatchInput): Promise<string> {
  if (input.patchPaths.length === 0) return "";
  const before = await createCheckpoint({
    repoRoot: input.repoRoot,
    paths: input.patchPaths,
    phase: "before",
    label: "apply_patch",
  });
  const after = await createCheckpoint({
    repoRoot: input.repoRoot,
    paths: input.patchPaths,
    phase: "after",
    label: "apply_patch",
  });
  return `\nCheckpoints:\n- before: ${before.id}\n- after: ${after.id}`;
}
