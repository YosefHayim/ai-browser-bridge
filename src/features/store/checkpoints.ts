import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { hasErrorCode } from "@/features/domain";
import { checkpointsDir } from "./paths.ts";

/** Checkpoint phase relative to a patch operation. */
export type CheckpointPhase = "before" | "after";

/** Snapshot of one file at checkpoint time. */
export interface CheckpointFileSnapshot {
  relativePath: string;
  exists: boolean;
  size: number;
  sha256?: string;
  snapshotRef?: string;
}

/** Full checkpoint record persisted on disk. */
export interface Checkpoint {
  id: string;
  repoRoot: string;
  createdAt: string;
  phase: CheckpointPhase;
  label?: string;
  files: CheckpointFileSnapshot[];
}

/** Summary row returned by {@link listCheckpoints}. */
export interface CheckpointSummary {
  id: string;
  createdAt: string;
  phase: CheckpointPhase;
  fileCount: number;
  label?: string;
}

/** Resolved absolute and relative path inside a repo. */
interface RepoPath {
  absolutePath: string;
  relativePath: string;
}

/** Options for {@link createCheckpoint}. */
export interface CreateCheckpointOptions {
  repoRoot: string;
  paths: readonly string[];
  phase?: CheckpointPhase;
  label?: string;
  checkpointRoot?: string;
  now?: Date;
}

/** Options for {@link listCheckpoints}. */
export interface ListCheckpointsOptions {
  repoRoot: string;
  checkpointRoot?: string;
}

/** Options for {@link restoreCheckpoint}. */
export interface RestoreCheckpointOptions {
  repoRoot: string;
  checkpointId: string;
  checkpointRoot?: string;
  paths?: readonly string[];
}

/** Result of {@link restoreCheckpoint}. */
export interface RestoreCheckpointResult {
  checkpointId: string;
  restored: string[];
  removed: string[];
}

interface CheckpointIdInput {
  repoRoot: string;
  createdAt: string;
  phase: CheckpointPhase;
  label?: string;
  paths: readonly string[];
}

interface CreateCheckpointBuildContext {
  repoRoot: string;
  createdAt: string;
  phase: CheckpointPhase;
  label?: string;
  resolvedPaths: RepoPath[];
  checkpointDir: string;
  filesDir: string;
  id: string;
}

const sha256 = (input: string | Buffer): string => {
  return createHash("sha256").update(input).digest("hex");
};

const toPosixPath = (path: string): string => {
  return path.split(sep).join("/");
};

const checkpointStorageRoot = (
  repoRoot: string,
  checkpointRoot = checkpointsDir(repoRoot),
): string => {
  return join(checkpointRoot, sha256(resolve(repoRoot)).slice(0, 16));
};

const checkpointMetadataPath = (checkpointDir: string): string => {
  return join(checkpointDir, "checkpoint.json");
};

const resolveRepoPath = (repoRoot: string, path: string): RepoPath => {
  const normalizedRoot = resolve(repoRoot);
  const absolutePath = resolve(normalizedRoot, path);
  if (absolutePath !== normalizedRoot && !absolutePath.startsWith(normalizedRoot + sep)) {
    throw new Error(`Path escapes repo root: ${path}`);
  }
  return {
    absolutePath,
    relativePath: toPosixPath(relative(normalizedRoot, absolutePath) || "."),
  };
};

const resolveInside = (root: string, path: string): string => {
  const normalizedRoot = resolve(root);
  const resolved = resolve(normalizedRoot, path);
  if (resolved !== normalizedRoot && !resolved.startsWith(normalizedRoot + sep)) {
    throw new Error(`Path escapes checkpoint store: ${path}`);
  }
  return resolved;
};

const uniquePaths = (paths: readonly string[]): string[] => {
  return [...new Set(paths)];
};

const checkpointId = (input: CheckpointIdInput): string => {
  const timestamp = input.createdAt.replace(/[:.]/g, "-");
  const digest = sha256(JSON.stringify(input)).slice(0, 12);
  return `${timestamp}-${input.phase}-${digest}`;
};

const defaultPhase = (phase?: CheckpointPhase): CheckpointPhase => {
  return phase ?? "before";
};

const buildCheckpointPaths = (ctx: {
  repoRoot: string;
  createdAt: string;
  phase: CheckpointPhase;
  label?: string;
  resolvedPaths: RepoPath[];
  checkpointRoot?: string;
}) => {
  const id = checkpointId({
    repoRoot: ctx.repoRoot,
    createdAt: ctx.createdAt,
    phase: ctx.phase,
    label: ctx.label,
    paths: ctx.resolvedPaths.map((entry) => entry.relativePath),
  });
  const checkpointDir = join(checkpointStorageRoot(ctx.repoRoot, ctx.checkpointRoot), id);
  return { id, checkpointDir, filesDir: join(checkpointDir, "files") };
};

const buildCreateCheckpointContext = (
  options: CreateCheckpointOptions,
): CreateCheckpointBuildContext => {
  const repoRoot = resolve(options.repoRoot);
  const phase = defaultPhase(options.phase);
  const createdAt = (options.now ?? new Date()).toISOString();
  const resolvedPaths = uniquePaths(options.paths).map((path) => resolveRepoPath(repoRoot, path));
  const base = { repoRoot, createdAt, phase, label: options.label, resolvedPaths };
  return { ...base, ...buildCheckpointPaths({ ...base, checkpointRoot: options.checkpointRoot }) };
};

const buildCheckpointRecord = (
  ctx: CreateCheckpointBuildContext,
  files: Checkpoint["files"],
): Checkpoint => {
  return {
    id: ctx.id,
    repoRoot: ctx.repoRoot,
    createdAt: ctx.createdAt,
    phase: ctx.phase,
    label: ctx.label,
    files,
  };
};

const buildSelectedPaths = (
  repoRoot: string,
  paths: readonly string[] | undefined,
): Set<string> | undefined => {
  if (!paths) return undefined;
  return new Set(paths.map((path) => resolveRepoPath(repoRoot, path).relativePath));
};

const tryStat = async (repoPath: RepoPath) => {
  try {
    return await stat(repoPath.absolutePath);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return undefined;
    throw error;
  }
};

const writeFileSnapshot = async (
  repoPath: RepoPath,
  filesDir: string,
  fileStat: Awaited<ReturnType<typeof stat>>,
): Promise<CheckpointFileSnapshot> => {
  const contents = await readFile(repoPath.absolutePath);
  const contentHash = sha256(contents);
  const snapshotRef = `${contentHash}-${sha256(repoPath.relativePath).slice(0, 12)}`;
  await writeFile(join(filesDir, snapshotRef), contents);
  return {
    relativePath: repoPath.relativePath,
    exists: true,
    size: Number(fileStat.size),
    sha256: contentHash,
    snapshotRef,
  };
};

const snapshotFile = async (
  repoPath: RepoPath,
  filesDir: string,
): Promise<CheckpointFileSnapshot> => {
  const fileStat = await tryStat(repoPath);
  if (!fileStat) return { relativePath: repoPath.relativePath, exists: false, size: 0 };
  if (fileStat.isDirectory())
    throw new Error(`Cannot checkpoint directory: ${repoPath.relativePath}`);
  if (!fileStat.isFile())
    throw new Error(`Cannot checkpoint non-file path: ${repoPath.relativePath}`);
  return writeFileSnapshot(repoPath, filesDir, fileStat);
};

const readCheckpoint = async (checkpointDir: string): Promise<Checkpoint | undefined> => {
  try {
    return JSON.parse(await readFile(checkpointMetadataPath(checkpointDir), "utf-8")) as Checkpoint;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return undefined;
    throw error;
  }
};

const writeCheckpointFiles = async (
  ctx: CreateCheckpointBuildContext,
): Promise<Checkpoint["files"]> => {
  await mkdir(ctx.filesDir, { recursive: true });
  const files = [];
  for (const repoPath of ctx.resolvedPaths) files.push(await snapshotFile(repoPath, ctx.filesDir));
  return files;
};

const persistCheckpoint = async (
  ctx: CreateCheckpointBuildContext,
  files: Checkpoint["files"],
): Promise<Checkpoint> => {
  const checkpoint = buildCheckpointRecord(ctx, files);
  await writeFile(
    checkpointMetadataPath(ctx.checkpointDir),
    JSON.stringify(checkpoint, null, 2),
    "utf-8",
  );
  return checkpoint;
};

const readCheckpointDirEntries = async (storeRoot: string): Promise<Dirent[]> => {
  try {
    return await readdir(storeRoot, { withFileTypes: true });
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return [];
    throw error;
  }
};

const tryReadCheckpointSummary = async (
  storeRoot: string,
  entry: Dirent,
): Promise<CheckpointSummary | null> => {
  if (!entry.isDirectory()) return null;
  const checkpoint = await readCheckpoint(join(storeRoot, entry.name));
  if (!checkpoint) return null;
  return {
    id: checkpoint.id,
    createdAt: checkpoint.createdAt,
    phase: checkpoint.phase,
    label: checkpoint.label,
    fileCount: checkpoint.files.length,
  };
};

const collectCheckpointSummaries = async (
  storeRoot: string,
  entries: Dirent[],
): Promise<CheckpointSummary[]> => {
  const checkpoints: CheckpointSummary[] = [];
  for (const entry of entries) {
    const summary = await tryReadCheckpointSummary(storeRoot, entry);
    if (summary) checkpoints.push(summary);
  }
  return checkpoints;
};

const sortCheckpointSummaries = (checkpoints: CheckpointSummary[]): CheckpointSummary[] => {
  return checkpoints.sort(
    (left, right) =>
      right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
  );
};

const restoreExistingFile = async (input: {
  repoRoot: string;
  checkpointDir: string;
  file: CheckpointFileSnapshot;
  target: RepoPath;
  restored: string[];
}): Promise<void> => {
  if (!input.file.snapshotRef)
    throw new Error(`Checkpoint file is missing snapshot data: ${input.file.relativePath}`);
  const snapshotPath = resolveInside(input.checkpointDir, join("files", input.file.snapshotRef));
  const contents = await readFile(snapshotPath);
  await mkdir(dirname(input.target.absolutePath), { recursive: true });
  await writeFile(input.target.absolutePath, contents);
  input.restored.push(input.target.relativePath);
};

const restoreFile = async (input: {
  repoRoot: string;
  checkpointDir: string;
  file: CheckpointFileSnapshot;
  restored: string[];
  removed: string[];
}): Promise<void> => {
  const target = resolveRepoPath(input.repoRoot, input.file.relativePath);
  if (input.file.exists) {
    await restoreExistingFile({ ...input, target });
    return;
  }
  await rm(target.absolutePath, { force: true });
  input.removed.push(target.relativePath);
};

const validateSelectedPaths = (
  checkpoint: Checkpoint,
  selectedPaths: Set<string> | undefined,
): void => {
  if (!selectedPaths) return;
  for (const selectedPath of selectedPaths) {
    if (!checkpoint.files.some((file) => file.relativePath === selectedPath)) {
      throw new Error(`Checkpoint does not include path: ${selectedPath}`);
    }
  }
};

const restoreAllFiles = async (input: {
  repoRoot: string;
  checkpointDir: string;
  checkpoint: Checkpoint;
  selectedPaths: Set<string> | undefined;
}): Promise<RestoreCheckpointResult> => {
  const restored: string[] = [];
  const removed: string[] = [];
  for (const file of input.checkpoint.files) {
    if (input.selectedPaths && !input.selectedPaths.has(file.relativePath)) continue;
    await restoreFile({
      repoRoot: input.repoRoot,
      checkpointDir: input.checkpointDir,
      file,
      restored,
      removed,
    });
  }
  validateSelectedPaths(input.checkpoint, input.selectedPaths);
  return { checkpointId: input.checkpoint.id, restored, removed };
};

/**
 * Snapshot the current state of repo files before or after a patch.
 *
 * @param options - Options that configure the operation.
 * @returns The `createCheckpoint` result.
 * @example
 * ```ts
 * const result = await createCheckpoint(options);
 * ```
 */
export const createCheckpoint = async (options: CreateCheckpointOptions): Promise<Checkpoint> => {
  const ctx = buildCreateCheckpointContext(options);
  const files = await writeCheckpointFiles(ctx);
  return persistCheckpoint(ctx, files);
};

/**
 * List checkpoints for a repository.
 *
 * @param options - Options that configure the operation.
 * @returns The `listCheckpoints` result.
 * @example
 * ```ts
 * const result = await listCheckpoints(options);
 * ```
 */
export const listCheckpoints = async (
  options: ListCheckpointsOptions,
): Promise<CheckpointSummary[]> => {
  const storeRoot = checkpointStorageRoot(options.repoRoot, options.checkpointRoot);
  const summaries = await collectCheckpointSummaries(
    storeRoot,
    await readCheckpointDirEntries(storeRoot),
  );
  return sortCheckpointSummaries(summaries);
};

/**
 * Restore all or selected files from a checkpoint.
 *
 * @param options - Options that configure the operation.
 * @returns The `restoreCheckpoint` result.
 * @example
 * ```ts
 * const result = await restoreCheckpoint(options);
 * ```
 */
export const restoreCheckpoint = async (
  options: RestoreCheckpointOptions,
): Promise<RestoreCheckpointResult> => {
  const repoRoot = resolve(options.repoRoot);
  const checkpointDir = join(
    checkpointStorageRoot(repoRoot, options.checkpointRoot),
    options.checkpointId,
  );
  const checkpoint = await readCheckpoint(checkpointDir);
  if (!checkpoint) throw new Error(`Checkpoint not found: ${options.checkpointId}`);
  return restoreAllFiles({
    repoRoot,
    checkpointDir,
    checkpoint,
    selectedPaths: buildSelectedPaths(repoRoot, options.paths),
  });
};
