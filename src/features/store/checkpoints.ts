import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Dirent } from "node:fs";
import { hasErrorCode } from "../domain/errors.ts";
import type {
  Checkpoint,
  CheckpointSummary,
  CreateCheckpointOptions,
  ListCheckpointsOptions,
  RestoreCheckpointOptions,
  RestoreCheckpointResult,
} from "./checkpoints.types.ts";
import { checkpointStorageRoot, metadataPath } from "./checkpoints.paths.ts";
import { readCheckpoint, snapshotFile } from "./checkpoints.snapshot.ts";
import { restoreAllFiles } from "./checkpoints.restore.ts";
import { collectCheckpointSummaries, sortCheckpointSummaries } from "./checkpoints.list.ts";
import { buildCreateCheckpointContext, buildCheckpointRecord, buildSelectedPaths } from "./checkpoints.build.ts";

export type {
  Checkpoint,
  CheckpointFileSnapshot,
  CheckpointPhase,
  CheckpointSummary,
  CreateCheckpointOptions,
  ListCheckpointsOptions,
  RestoreCheckpointOptions,
  RestoreCheckpointResult,
} from "./checkpoints.types.ts";

/** Snapshot the current state of repo files before or after a patch. */
export async function createCheckpoint(options: CreateCheckpointOptions): Promise<Checkpoint> {
  const ctx = buildCreateCheckpointContext(options);
  const files = await writeCheckpointFiles(ctx);
  return persistCheckpoint({ ctx, files });
}

/** List checkpoints for a repository. */
export async function listCheckpoints(options: ListCheckpointsOptions): Promise<CheckpointSummary[]> {
  const storeRoot = checkpointStorageRoot(options.repoRoot, options.checkpointRoot);
  const summaries = await collectCheckpointSummaries({ storeRoot, entries: await readCheckpointDirEntries(storeRoot) });
  return sortCheckpointSummaries(summaries);
}

/** Restore all or selected files from a checkpoint. */
export async function restoreCheckpoint(options: RestoreCheckpointOptions): Promise<RestoreCheckpointResult> {
  const repoRoot = resolve(options.repoRoot);
  const checkpointDir = join(checkpointStorageRoot(repoRoot, options.checkpointRoot), options.checkpointId);
  const checkpoint = await readCheckpoint(checkpointDir);
  if (!checkpoint) throw new Error(`Checkpoint not found: ${options.checkpointId}`);
  return restoreAllFiles({
    repoRoot,
    checkpointDir,
    checkpoint,
    selectedPaths: buildSelectedPaths({ repoRoot, paths: options.paths }),
  });
}

/** Snapshot files and return file metadata. */
async function writeCheckpointFiles(ctx: ReturnType<typeof buildCreateCheckpointContext>) {
  await mkdir(ctx.filesDir, { recursive: true });
  const files = [];
  for (const repoPath of ctx.resolvedPaths) files.push(await snapshotFile(repoPath, ctx.filesDir));
  return files;
}

/** Write checkpoint metadata and return the record. */
async function persistCheckpoint(input: { ctx: ReturnType<typeof buildCreateCheckpointContext>; files: Checkpoint["files"] }) {
  const checkpoint = buildCheckpointRecord(input.ctx, input.files);
  await writeFile(metadataPath(input.ctx.checkpointDir), JSON.stringify(checkpoint, null, 2), "utf-8");
  return checkpoint;
}

/** Read checkpoint store directory entries, returning [] when missing. */
async function readCheckpointDirEntries(storeRoot: string): Promise<Dirent[]> {
  try {
    return await readdir(storeRoot, { withFileTypes: true });
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return [];
    throw error;
  }
}
