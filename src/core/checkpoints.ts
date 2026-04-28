import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";

export type CheckpointPhase = "before" | "after";

export interface CheckpointFileSnapshot {
  relativePath: string;
  exists: boolean;
  size: number;
  sha256?: string;
  snapshotRef?: string;
}

export interface Checkpoint {
  id: string;
  repoRoot: string;
  createdAt: string;
  phase: CheckpointPhase;
  label?: string;
  files: CheckpointFileSnapshot[];
}

export interface CheckpointSummary {
  id: string;
  createdAt: string;
  phase: CheckpointPhase;
  fileCount: number;
  label?: string;
}

export interface CreateCheckpointOptions {
  repoRoot: string;
  paths: readonly string[];
  phase?: CheckpointPhase;
  label?: string;
  checkpointRoot?: string;
  now?: Date;
}

export interface ListCheckpointsOptions {
  repoRoot: string;
  checkpointRoot?: string;
}

export interface RestoreCheckpointOptions {
  repoRoot: string;
  checkpointId: string;
  checkpointRoot?: string;
  paths?: readonly string[];
}

export interface RestoreCheckpointResult {
  checkpointId: string;
  restored: string[];
  removed: string[];
}

interface RepoPath {
  absolutePath: string;
  relativePath: string;
}

const DEFAULT_CHECKPOINT_ROOT = join(homedir(), ".chatgpt-bridge", "checkpoints");

/** Resolve the per-repository checkpoint store path. */
export function checkpointStorageRoot(
  repoRoot: string,
  checkpointRoot = DEFAULT_CHECKPOINT_ROOT,
): string {
  return join(checkpointRoot, sha256(resolve(repoRoot)).slice(0, 16));
}

/** Resolve and validate a path so every target stays inside the repo root. */
export function resolveRepoPath(repoRoot: string, path: string): RepoPath {
  const normalizedRoot = resolve(repoRoot);
  const absolutePath = resolve(normalizedRoot, path);

  if (absolutePath !== normalizedRoot && !absolutePath.startsWith(normalizedRoot + sep)) {
    throw new Error(`Path escapes repo root: ${path}`);
  }

  return {
    absolutePath,
    relativePath: toPosixPath(relative(normalizedRoot, absolutePath) || "."),
  };
}

/** Snapshot the current state of repo files before or after a patch. */
export async function createCheckpoint(options: CreateCheckpointOptions): Promise<Checkpoint> {
  const repoRoot = resolve(options.repoRoot);
  const phase = options.phase ?? "before";
  const createdAt = (options.now ?? new Date()).toISOString();
  const resolvedPaths = uniquePaths(options.paths).map((path) => resolveRepoPath(repoRoot, path));
  const id = checkpointId({
    repoRoot,
    createdAt,
    phase,
    label: options.label,
    paths: resolvedPaths.map((path) => path.relativePath),
  });
  const checkpointDir = join(checkpointStorageRoot(repoRoot, options.checkpointRoot), id);
  const filesDir = join(checkpointDir, "files");
  const files: CheckpointFileSnapshot[] = [];

  await mkdir(filesDir, { recursive: true });

  for (const repoPath of resolvedPaths) {
    const file = await snapshotFile(repoPath, filesDir);
    files.push(file);
  }

  const checkpoint: Checkpoint = {
    id,
    repoRoot,
    createdAt,
    phase,
    label: options.label,
    files,
  };

  await writeFile(metadataPath(checkpointDir), JSON.stringify(checkpoint, null, 2), "utf-8");
  return checkpoint;
}

/** List checkpoints for a repository. */
export async function listCheckpoints(
  options: ListCheckpointsOptions,
): Promise<CheckpointSummary[]> {
  const storeRoot = checkpointStorageRoot(options.repoRoot, options.checkpointRoot);
  let entries: Dirent[];

  try {
    entries = await readdir(storeRoot, { withFileTypes: true });
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return [];
    throw error;
  }

  const checkpoints: CheckpointSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const checkpoint = await readCheckpoint(join(storeRoot, entry.name));
    if (!checkpoint) continue;
    checkpoints.push({
      id: checkpoint.id,
      createdAt: checkpoint.createdAt,
      phase: checkpoint.phase,
      label: checkpoint.label,
      fileCount: checkpoint.files.length,
    });
  }

  return checkpoints.sort(
    (left, right) =>
      right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
  );
}

/** Restore all or selected files from a checkpoint. */
export async function restoreCheckpoint(
  options: RestoreCheckpointOptions,
): Promise<RestoreCheckpointResult> {
  const repoRoot = resolve(options.repoRoot);
  const checkpointDir = join(
    checkpointStorageRoot(repoRoot, options.checkpointRoot),
    options.checkpointId,
  );
  const checkpoint = await readCheckpoint(checkpointDir);

  if (!checkpoint) {
    throw new Error(`Checkpoint not found: ${options.checkpointId}`);
  }

  const selectedPaths = options.paths
    ? new Set(options.paths.map((path) => resolveRepoPath(repoRoot, path).relativePath))
    : undefined;
  const restored: string[] = [];
  const removed: string[] = [];

  for (const file of checkpoint.files) {
    const target = resolveRepoPath(repoRoot, file.relativePath);
    if (selectedPaths && !selectedPaths.has(target.relativePath)) continue;

    if (file.exists) {
      if (!file.snapshotRef) {
        throw new Error(`Checkpoint file is missing snapshot data: ${file.relativePath}`);
      }
      const snapshotPath = resolveInside(checkpointDir, join("files", file.snapshotRef));
      const contents = await readFile(snapshotPath);
      await mkdir(dirname(target.absolutePath), { recursive: true });
      await writeFile(target.absolutePath, contents);
      restored.push(target.relativePath);
    } else {
      await rm(target.absolutePath, { force: true });
      removed.push(target.relativePath);
    }
  }

  if (selectedPaths) {
    for (const selectedPath of selectedPaths) {
      if (!checkpoint.files.some((file) => file.relativePath === selectedPath)) {
        throw new Error(`Checkpoint does not include path: ${selectedPath}`);
      }
    }
  }

  return { checkpointId: checkpoint.id, restored, removed };
}

async function snapshotFile(
  repoPath: RepoPath,
  filesDir: string,
): Promise<CheckpointFileSnapshot> {
  let fileStat: Awaited<ReturnType<typeof stat>>;
  try {
    fileStat = await stat(repoPath.absolutePath);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return {
        relativePath: repoPath.relativePath,
        exists: false,
        size: 0,
      };
    }
    throw error;
  }

  if (fileStat.isDirectory()) {
    throw new Error(`Cannot checkpoint directory: ${repoPath.relativePath}`);
  }

  if (!fileStat.isFile()) {
    throw new Error(`Cannot checkpoint non-file path: ${repoPath.relativePath}`);
  }

  const contents = await readFile(repoPath.absolutePath);
  const contentHash = sha256(contents);
  const snapshotRef = `${contentHash}-${sha256(repoPath.relativePath).slice(0, 12)}`;
  await writeFile(join(filesDir, snapshotRef), contents);

  return {
    relativePath: repoPath.relativePath,
    exists: true,
    size: fileStat.size,
    sha256: contentHash,
    snapshotRef,
  };
}

async function readCheckpoint(checkpointDir: string): Promise<Checkpoint | undefined> {
  try {
    return JSON.parse(await readFile(metadataPath(checkpointDir), "utf-8")) as Checkpoint;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return undefined;
    throw error;
  }
}

function metadataPath(checkpointDir: string): string {
  return join(checkpointDir, "checkpoint.json");
}

function checkpointId(input: {
  repoRoot: string;
  createdAt: string;
  phase: CheckpointPhase;
  label?: string;
  paths: readonly string[];
}): string {
  const timestamp = input.createdAt.replace(/[:.]/g, "-");
  const digest = sha256(JSON.stringify(input)).slice(0, 12);
  return `${timestamp}-${input.phase}-${digest}`;
}

function resolveInside(root: string, path: string): string {
  const normalizedRoot = resolve(root);
  const resolved = resolve(normalizedRoot, path);
  if (resolved !== normalizedRoot && !resolved.startsWith(normalizedRoot + sep)) {
    throw new Error(`Path escapes checkpoint store: ${path}`);
  }
  return resolved;
}

function uniquePaths(paths: readonly string[]): string[] {
  return [...new Set(paths)];
}

function toPosixPath(path: string): string {
  return path.split(sep).join("/");
}

function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}
