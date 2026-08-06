import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { hasErrorCode } from "@/features/domain";
import { checkpointsDir } from "./paths.ts";

export type CheckpointPhase = "before" | "after";

export type CheckpointFileSnapshot = {
  relativePath: string;
  exists: boolean;
  size: number;
  sha256?: string;
  snapshotRef?: string;
};

export type Checkpoint = {
  id: string;
  repoRoot: string;
  createdAt: string;
  phase: CheckpointPhase;
  label?: string;
  files: CheckpointFileSnapshot[];
};

export type CheckpointSummary = {
  id: string;
  createdAt: string;
  phase: CheckpointPhase;
  fileCount: number;
  label?: string;
};

type RepoPath = {
  absolutePath: string;
  relativePath: string;
};

export type CreateCheckpointOptions = {
  repoRoot: string;
  paths: readonly string[];
  phase?: CheckpointPhase;
  label?: string;
  checkpointRoot?: string;
  now?: Date;
};

export type ListCheckpointsOptions = {
  repoRoot: string;
  checkpointRoot?: string;
};

export type RestoreCheckpointOptions = {
  repoRoot: string;
  checkpointId: string;
  checkpointRoot?: string;
  paths?: readonly string[];
};

export type RestoreCheckpointResult = {
  checkpointId: string;
  restored: string[];
  removed: string[];
};

type CheckpointIdInput = {
  repoRoot: string;
  createdAt: string;
  phase: CheckpointPhase;
  label?: string;
  paths: readonly string[];
};

type CheckpointWriteContext = {
  repoRoot: string;
  createdAt: string;
  phase: CheckpointPhase;
  label?: string;
  resolvedPaths: RepoPath[];
  checkpointDir: string;
  filesDir: string;
  id: string;
};

const sha256 = (input: string | Buffer): string => {
  return createHash("sha256").update(input).digest("hex");
};

const posixPath = (path: string): string => {
  return path.split(sep).join("/");
};

const checkpointStorageRoot = (repoRoot: string, checkpointRoot: string | undefined): string => {
  const root = checkpointRoot === undefined ? checkpointsDir(repoRoot) : checkpointRoot;
  return join(root, sha256(resolve(repoRoot)).slice(0, 16));
};

const checkpointMetadataPath = (checkpointDir: string): string => {
  return join(checkpointDir, "checkpoint.json");
};

const repositorySnapshotPath = (repoRoot: string, path: string): RepoPath => {
  const normalizedRoot = resolve(repoRoot);
  const absolutePath = resolve(normalizedRoot, path);
  if (absolutePath !== normalizedRoot && !absolutePath.startsWith(normalizedRoot + sep)) {
    throw new Error(`Path escapes repo root: ${path}`);
  }
  const relativeFromRoot = relative(normalizedRoot, absolutePath);
  const relativePath = relativeFromRoot.length === 0 ? "." : posixPath(relativeFromRoot);
  return {
    absolutePath,
    relativePath,
  };
};

const pathInside = (root: string, path: string): string => {
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

const checkpointPhase = (phase: CheckpointPhase | undefined): CheckpointPhase => {
  if (phase === undefined) return "before";
  return phase;
};

const checkpointPaths = (input: {
  repoRoot: string;
  createdAt: string;
  phase: CheckpointPhase;
  label?: string;
  resolvedPaths: RepoPath[];
  checkpointRoot?: string;
}) => {
  const id = checkpointId({
    repoRoot: input.repoRoot,
    createdAt: input.createdAt,
    phase: input.phase,
    label: input.label,
    paths: input.resolvedPaths.map((entry) => entry.relativePath),
  });
  const checkpointDir = join(checkpointStorageRoot(input.repoRoot, input.checkpointRoot), id);
  return { id, checkpointDir, filesDir: join(checkpointDir, "files") };
};

const checkpointWriteContext = (options: CreateCheckpointOptions): CheckpointWriteContext => {
  const repoRoot = resolve(options.repoRoot);
  const phase = checkpointPhase(options.phase);
  const createdAt =
    options.now === undefined ? new Date().toISOString() : options.now.toISOString();
  const resolvedPaths = uniquePaths(options.paths).map((path) =>
    repositorySnapshotPath(repoRoot, path),
  );
  const base = { repoRoot, createdAt, phase, label: options.label, resolvedPaths };
  return {
    ...base,
    ...checkpointPaths({ ...base, checkpointRoot: options.checkpointRoot }),
  };
};

const checkpointRecord = (
  writeContext: CheckpointWriteContext,
  files: Checkpoint["files"],
): Checkpoint => {
  return {
    id: writeContext.id,
    repoRoot: writeContext.repoRoot,
    createdAt: writeContext.createdAt,
    phase: writeContext.phase,
    label: writeContext.label,
    files,
  };
};

const selectedRelativePaths = (
  repoRoot: string,
  paths: readonly string[] | undefined,
): Set<string> | undefined => {
  if (paths === undefined) return undefined;
  return new Set(paths.map((path) => repositorySnapshotPath(repoRoot, path).relativePath));
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
  writeContext: CheckpointWriteContext,
): Promise<Checkpoint["files"]> => {
  await mkdir(writeContext.filesDir, { recursive: true });
  const files = [];
  for (const repoPath of writeContext.resolvedPaths)
    files.push(await snapshotFile(repoPath, writeContext.filesDir));
  return files;
};

const persistCheckpoint = async (
  writeContext: CheckpointWriteContext,
  files: Checkpoint["files"],
): Promise<Checkpoint> => {
  const checkpoint = checkpointRecord(writeContext, files);
  await writeFile(
    checkpointMetadataPath(writeContext.checkpointDir),
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
): Promise<CheckpointSummary | undefined> => {
  if (!entry.isDirectory()) return undefined;
  const checkpoint = await readCheckpoint(join(storeRoot, entry.name));
  if (!checkpoint) return undefined;
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
  return checkpoints.sort((left, right) => {
    const byCreatedAt = right.createdAt.localeCompare(left.createdAt);
    if (byCreatedAt !== 0) return byCreatedAt;
    return right.id.localeCompare(left.id);
  });
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
  const snapshotPath = pathInside(input.checkpointDir, join("files", input.file.snapshotRef));
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
  const target = repositorySnapshotPath(input.repoRoot, input.file.relativePath);
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

/** Snapshot the current state of repo files before or after a patch. */
export const createCheckpoint = async (options: CreateCheckpointOptions): Promise<Checkpoint> => {
  const writeContext = checkpointWriteContext(options);
  const files = await writeCheckpointFiles(writeContext);
  return persistCheckpoint(writeContext, files);
};

/** List checkpoints for a repository. */
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

/** Restore all or selected files from a checkpoint. */
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
    selectedPaths: selectedRelativePaths(repoRoot, options.paths),
  });
};
