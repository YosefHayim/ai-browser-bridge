import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Checkpoint, CheckpointFileSnapshot, RestoreCheckpointResult } from "./checkpoints.types.ts";
import { resolveInside, resolveRepoPath } from "./checkpoints.paths.ts";

/** Context for restoring one file from a checkpoint snapshot. */
export interface RestoreFileContext {
  /** Absolute repo root. */
  repoRoot: string;
  /** Checkpoint directory on disk. */
  checkpointDir: string;
  /** File snapshot to restore. */
  file: CheckpointFileSnapshot;
  /** Accumulator for restored relative paths. */
  restored: string[];
  /** Accumulator for removed relative paths. */
  removed: string[];
}

/** Restore one file snapshot into the repo. */
export async function restoreFile(ctx: RestoreFileContext): Promise<void> {
  const target = resolveRepoPath(ctx.repoRoot, ctx.file.relativePath);
  if (ctx.file.exists) {
    await restoreExistingFile({ ...ctx, target });
    return;
  }
  await rm(target.absolutePath, { force: true });
  ctx.removed.push(target.relativePath);
}

/** Context for restoring an existing file from a snapshot. */
interface RestoreExistingFileContext extends RestoreFileContext {
  /** Resolved target path in the repo. */
  target: ReturnType<typeof resolveRepoPath>;
}

/** Write snapshot contents back to an existing repo file. */
async function restoreExistingFile(ctx: RestoreExistingFileContext): Promise<void> {
  if (!ctx.file.snapshotRef) throw new Error(`Checkpoint file is missing snapshot data: ${ctx.file.relativePath}`);
  await writeRestoredSnapshot(ctx);
  ctx.restored.push(ctx.target.relativePath);
}

/** Read snapshot bytes and write them to the target repo path. */
async function writeRestoredSnapshot(ctx: RestoreExistingFileContext): Promise<void> {
  const snapshotPath = resolveInside(ctx.checkpointDir, join("files", ctx.file.snapshotRef!));
  const contents = await readFile(snapshotPath);
  await mkdir(dirname(ctx.target.absolutePath), { recursive: true });
  await writeFile(ctx.target.absolutePath, contents);
}

/** Context for validating selected restore paths exist in the checkpoint. */
export interface ValidateSelectedPathsContext {
  /** Checkpoint being restored. */
  checkpoint: Checkpoint;
  /** Selected relative paths, or undefined for full restore. */
  selectedPaths: Set<string> | undefined;
}

/** Ensure every selected path is present in the checkpoint. */
export function validateSelectedPaths(ctx: ValidateSelectedPathsContext): void {
  if (!ctx.selectedPaths) return;
  for (const selectedPath of ctx.selectedPaths) {
    if (!ctx.checkpoint.files.some((file) => file.relativePath === selectedPath)) {
      throw new Error(`Checkpoint does not include path: ${selectedPath}`);
    }
  }
}

/** Context for restoring all files from a checkpoint. */
export interface RestoreAllFilesContext {
  /** Absolute repo root. */
  repoRoot: string;
  /** Checkpoint directory on disk. */
  checkpointDir: string;
  /** Loaded checkpoint record. */
  checkpoint: Checkpoint;
  /** Optional subset of relative paths to restore. */
  selectedPaths: Set<string> | undefined;
}

/** Restore all matching files and return path lists. */
export async function restoreAllFiles(ctx: RestoreAllFilesContext): Promise<RestoreCheckpointResult> {
  const restored: string[] = [];
  const removed: string[] = [];
  for (const file of ctx.checkpoint.files) {
    if (ctx.selectedPaths && !ctx.selectedPaths.has(file.relativePath)) continue;
    await restoreFile({ repoRoot: ctx.repoRoot, checkpointDir: ctx.checkpointDir, file, restored, removed });
  }
  validateSelectedPaths({ checkpoint: ctx.checkpoint, selectedPaths: ctx.selectedPaths });
  return { checkpointId: ctx.checkpoint.id, restored, removed };
}
