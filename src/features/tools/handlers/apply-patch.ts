import { z } from "zod";
import { ensureInsideRepo } from "../sandbox.ts";
import type { ToolDef } from "../../domain/types.ts";
import { createPatchCheckpoints, runGitApply } from "./apply-patch.helpers.ts";

/** Apply a unified diff patch via git apply. */
async function applyPatch(
  args: Record<string, unknown>,
): Promise<{ ok: boolean; output: string }> {
  const input = readApplyPatchInput(args);
  ensureInsideRepo(".", input.repoRoot);
  const patchPaths = extractPatchPaths(input.patch);
  const applied = await runGitApply({ patch: input.patch, repoRoot: input.repoRoot, patchPaths });
  return applied.ok
    ? { ok: true, output: applied.output + await createPatchCheckpoints({ patch: input.patch, repoRoot: input.repoRoot, patchPaths }) }
    : applied;
}

function readApplyPatchInput(args: Record<string, unknown>): { patch: string; repoRoot: string } {
  return { patch: String(args.patch), repoRoot: String(args._repoRoot) };
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
      addPatchPath({ paths, path: gitMatch[1] });
      addPatchPath({ paths, path: gitMatch[2] });
      continue;
    }

    const fileMatch = /^(---|\+\+\+) (?:a|b)\/(.+)$/.exec(line);
    if (fileMatch) addPatchPath({ paths, path: fileMatch[2] });
  }
  return [...paths];
}

function addPatchPath(input: { paths: Set<string>; path: string }): void {
  const trimmed = input.path.trim();
  if (!trimmed || trimmed === "/dev/null") return;
  input.paths.add(trimmed);
}
