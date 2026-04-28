import { z } from "zod";
import { ensureInsideRepo, trimOutput } from "../sandbox.ts";
import type { ToolDef } from "../../types/types.ts";
import { runProcess } from "./process.ts";
import { createCheckpoint } from "../../core/checkpoints.ts";

/** Apply a unified diff patch via git apply. */
async function applyPatch(
  args: Record<string, unknown>,
): Promise<{ ok: boolean; output: string }> {
  const patch = String(args.patch);
  const repoRoot = String(args._repoRoot);
  ensureInsideRepo(".", repoRoot);
  const patchPaths = extractPatchPaths(patch);
  const before = patchPaths.length > 0
    ? await createCheckpoint({
        repoRoot,
        paths: patchPaths,
        phase: "before",
        label: "apply_patch",
      })
    : null;

  // Dry-run check first
  const check = await runProcess(
    ["git", "apply", "--check", "-"],
    repoRoot,
    { stdin: patch, timeoutMs: 20_000 },
  );
  if (check.code !== 0) {
    return { ok: false, output: `Patch check failed:\n${trimOutput(check.stderr || check.stdout)}` };
  }

  // Apply for real
  const applied = await runProcess(
    ["git", "apply", "-"],
    repoRoot,
    { stdin: patch, timeoutMs: 20_000 },
  );
  if (applied.code !== 0) {
    return { ok: false, output: `Patch apply failed:\n${trimOutput(applied.stderr || applied.stdout)}` };
  }

  const after = patchPaths.length > 0
    ? await createCheckpoint({
        repoRoot,
        paths: patchPaths,
        phase: "after",
        label: "apply_patch",
      })
    : null;

  const checkpointText = before && after
    ? `\nCheckpoints:\n- before: ${before.id}\n- after: ${after.id}`
    : "";
  return { ok: true, output: `Patch applied successfully.${checkpointText}` };
}

export const applyPatchTool: ToolDef = {
  name: "apply_patch",
  description:
    "Apply a unified diff patch to the repository. Use only after reading the relevant files.",
  annotations: {
    title: "Apply patch",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  parameters: {
    patch: z.string().describe("Unified diff patch compatible with git apply."),
  },
  handler: applyPatch,
};

export function extractPatchPaths(patch: string): string[] {
  const paths = new Set<string>();
  for (const line of patch.split(/\r?\n/)) {
    const gitMatch = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (gitMatch) {
      addPatchPath(paths, gitMatch[1]);
      addPatchPath(paths, gitMatch[2]);
      continue;
    }

    const fileMatch = /^(---|\+\+\+) (?:a|b)\/(.+)$/.exec(line);
    if (fileMatch) addPatchPath(paths, fileMatch[2]);
  }
  return [...paths];
}

function addPatchPath(paths: Set<string>, path: string): void {
  const trimmed = path.trim();
  if (!trimmed || trimmed === "/dev/null") return;
  paths.add(trimmed);
}
