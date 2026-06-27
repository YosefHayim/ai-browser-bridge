import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { hasErrorCode } from "../domain/errors.ts";
import type { Checkpoint, CheckpointFileSnapshot, RepoPath } from "./checkpoints.types.ts";
import { metadataPath, sha256 } from "./checkpoints.paths.ts";

/** Snapshot one repo file into a checkpoint files directory. */
export async function snapshotFile(repoPath: RepoPath, filesDir: string): Promise<CheckpointFileSnapshot> {
  const fileStat = await tryStat(repoPath);
  if (!fileStat) return { relativePath: repoPath.relativePath, exists: false, size: 0 };
  validateFileStat({ repoPath, fileStat });
  return writeFileSnapshot({ repoPath, filesDir, fileStat });
}

/** Read a checkpoint record from disk, or undefined when missing. */
export async function readCheckpoint(checkpointDir: string): Promise<Checkpoint | undefined> {
  try {
    return JSON.parse(await readFile(metadataPath(checkpointDir), "utf-8")) as Checkpoint;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return undefined;
    throw error;
  }
}

/** Context for validating a file stat result. */
interface ValidateFileStatContext {
  /** Resolved repo path. */
  repoPath: RepoPath;
  /** Filesystem stat result. */
  fileStat: Awaited<ReturnType<typeof stat>>;
}

/** Reject directories and non-file paths. */
function validateFileStat(ctx: ValidateFileStatContext): void {
  if (ctx.fileStat.isDirectory()) throw new Error(`Cannot checkpoint directory: ${ctx.repoPath.relativePath}`);
  if (!ctx.fileStat.isFile()) throw new Error(`Cannot checkpoint non-file path: ${ctx.repoPath.relativePath}`);
}

/** Context for writing a file snapshot to the checkpoint store. */
interface WriteFileSnapshotContext {
  /** Resolved repo path. */
  repoPath: RepoPath;
  /** Checkpoint files directory. */
  filesDir: string;
  /** Filesystem stat result. */
  fileStat: Awaited<ReturnType<typeof stat>>;
}

/** Copy file contents into the checkpoint store and return metadata. */
async function writeFileSnapshot(ctx: WriteFileSnapshotContext): Promise<CheckpointFileSnapshot> {
  const contents = await readFile(ctx.repoPath.absolutePath);
  const contentHash = sha256(contents);
  const snapshotRef = `${contentHash}-${sha256(ctx.repoPath.relativePath).slice(0, 12)}`;
  await writeFile(join(ctx.filesDir, snapshotRef), contents);
  return {
    relativePath: ctx.repoPath.relativePath,
    exists: true,
    size: Number(ctx.fileStat.size),
    sha256: contentHash,
    snapshotRef,
  };
}

/** Stat a repo path, returning undefined when the file is absent. */
async function tryStat(repoPath: RepoPath) {
  try {
    return await stat(repoPath.absolutePath);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return undefined;
    throw error;
  }
}
