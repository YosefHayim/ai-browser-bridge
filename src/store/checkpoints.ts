import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { hasErrorCode } from "@/domain/errors.ts";
import { readCheckpointsDirectory } from "./paths.ts";

type CheckpointPhase = "before" | "after";

type CheckpointFileSnapshot = {
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

export type CreateCheckpointSettings = {
  repoRoot: string;
  paths: readonly string[];
  phase?: CheckpointPhase;
  label?: string;
  checkpointRoot?: string;
  now?: Date;
};

export type ListCheckpointsSettings = {
  repoRoot: string;
  checkpointRoot?: string;
};

export type RestoreCheckpointSettings = {
  repoRoot: string;
  checkpointId: string;
  checkpointRoot?: string;
  paths?: readonly string[];
};

export type RestoreCheckpointReport = {
  checkpointId: string;
  restored: string[];
  removed: string[];
};

type CheckpointIdDetails = {
  repoRoot: string;
  createdAt: string;
  phase: CheckpointPhase;
  label?: string;
  paths: readonly string[];
};

type CheckpointDraft = {
  repoRoot: string;
  createdAt: string;
  phase: CheckpointPhase;
  label?: string;
  resolvedPaths: RepoPath[];
  checkpointDir: string;
  filesDir: string;
  id: string;
};

const hashSha256 = (details: string | Buffer): string => {
  return createHash("sha256").update(details).digest("hex");
};

const readPosixPath = (path: string): string => {
  return path.split(sep).join("/");
};

const readCheckpointStorageRoot = (
  repoRoot: string,
  checkpointRoot: string | undefined,
): string => {
  const isCheckpointRootMissing = checkpointRoot == null;
  const root = isCheckpointRootMissing ? readCheckpointsDirectory(repoRoot) : checkpointRoot;
  return join(root, hashSha256(resolve(repoRoot)).slice(0, 16));
};

const readCheckpointMetadataPath = (checkpointDirectory: string): string => {
  return join(checkpointDirectory, "checkpoint.json");
};

const readRepositorySnapshotPath = (repoRoot: string, path: string): RepoPath => {
  const normalizedRoot = resolve(repoRoot);

  const absolutePath = resolve(normalizedRoot, path);
  const isOutsideRoot =
    absolutePath !== normalizedRoot && !absolutePath.startsWith(normalizedRoot + sep);
  if (isOutsideRoot) {
    throw new Error(`Path escapes repo root: ${path}`);
  }

  const relativeFromRoot = relative(normalizedRoot, absolutePath);
  const isRelativeFromRootEmpty = relativeFromRoot.length === 0;
  const relativePath = isRelativeFromRootEmpty ? "." : readPosixPath(relativeFromRoot);
  return {
    absolutePath,
    relativePath,
  };
};

const readPathInside = (root: string, path: string): string => {
  const normalizedRoot = resolve(root);

  const fulfill = resolve(normalizedRoot, path);
  const isTargetOutsideRoot =
    fulfill !== normalizedRoot && !fulfill.startsWith(normalizedRoot + sep);
  if (isTargetOutsideRoot) {
    throw new Error(`Path escapes checkpoint store: ${path}`);
  }

  return fulfill;
};

const listUniquePaths = (paths: readonly string[]): string[] => {
  return [...new Set(paths)];
};

const readCheckpointId = (details: CheckpointIdDetails): string => {
  const timestamp = details.createdAt.replace(/[:.]/g, "-");
  const serializedCheckpointDetails = JSON.stringify(details);
  const digest = hashSha256(serializedCheckpointDetails).slice(0, 12);
  return `${timestamp}-${details.phase}-${digest}`;
};

const readCheckpointPhase = (phase: CheckpointPhase | undefined): CheckpointPhase => {
  const isPhaseMissing = phase == null;
  if (isPhaseMissing) return "before";

  return phase;
};

const readCheckpointPaths = (details: {
  repoRoot: string;
  createdAt: string;
  phase: CheckpointPhase;
  label?: string;
  resolvedPaths: RepoPath[];
  checkpointRoot?: string;
}) => {
  const id = readCheckpointId({
    repoRoot: details.repoRoot,
    createdAt: details.createdAt,
    phase: details.phase,
    label: details.label,
    paths: details.resolvedPaths.map((line) => line.relativePath),
  });
  const checkpointStorageRoot = readCheckpointStorageRoot(details.repoRoot, details.checkpointRoot);
  const checkpointDirectory = join(checkpointStorageRoot, id);
  return { id, checkpointDir: checkpointDirectory, filesDir: join(checkpointDirectory, "files") };
};

const readCheckpointDraft = (settings: CreateCheckpointSettings): CheckpointDraft => {
  const repoRoot = resolve(settings.repoRoot);
  const phase = readCheckpointPhase(settings.phase);
  const createdAt = settings.now == null ? new Date().toISOString() : settings.now.toISOString();
  const snapshotPaths = listUniquePaths(settings.paths).map((path) =>
    readRepositorySnapshotPath(repoRoot, path),
  );
  const base = { repoRoot, createdAt, phase, label: settings.label, resolvedPaths: snapshotPaths };
  return {
    ...base,
    ...readCheckpointPaths({ ...base, checkpointRoot: settings.checkpointRoot }),
  };
};

const createCheckpointFromDraft = (
  checkpointDraft: CheckpointDraft,
  files: Checkpoint["files"],
): Checkpoint => {
  return {
    id: checkpointDraft.id,
    repoRoot: checkpointDraft.repoRoot,
    createdAt: checkpointDraft.createdAt,
    phase: checkpointDraft.phase,
    label: checkpointDraft.label,
    files,
  };
};

const readSelectedRelativePaths = (
  repoRoot: string,
  paths: readonly string[] | undefined,
): Set<string> | null => {
  const isPathsMissing = paths == null;
  if (isPathsMissing) return null;

  return new Set(paths.map((path) => readRepositorySnapshotPath(repoRoot, path).relativePath));
};

const tryStat = async (repoPath: RepoPath) => {
  try {
    return await stat(repoPath.absolutePath);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return null;

    throw error;
  }
};

const writeFileSnapshot = async (
  repoPath: RepoPath,
  filesDirectory: string,
  fileStat: Awaited<ReturnType<typeof stat>>,
): Promise<CheckpointFileSnapshot> => {
  const messages = await readFile(repoPath.absolutePath);
  const messageHash = hashSha256(messages);
  const snapshotRef = `${messageHash}-${hashSha256(repoPath.relativePath).slice(0, 12)}`;
  const snapshotPath = join(filesDirectory, snapshotRef);
  await writeFile(snapshotPath, messages);
  return {
    relativePath: repoPath.relativePath,
    exists: true,
    size: Number(fileStat.size),
    sha256: messageHash,
    snapshotRef,
  };
};

const snapshotFile = async (
  repoPath: RepoPath,
  filesDirectory: string,
): Promise<CheckpointFileSnapshot> => {
  const fileStat = await tryStat(repoPath);

  const isFileStatMissing = fileStat == null;
  if (isFileStatMissing) {
    return { relativePath: repoPath.relativePath, exists: false, size: 0 };
  }

  const isDirectoryFileStat = fileStat.isDirectory();
  if (isDirectoryFileStat) {
    throw new Error(`Cannot checkpoint directory: ${repoPath.relativePath}`);
  }

  const isNotFileFileStat = !fileStat.isFile();
  if (isNotFileFileStat) {
    throw new Error(`Cannot checkpoint non-file path: ${repoPath.relativePath}`);
  }

  return writeFileSnapshot(repoPath, filesDirectory, fileStat);
};

const readCheckpoint = async (checkpointDirectory: string): Promise<Checkpoint | null> => {
  try {
    const metadataPath = readCheckpointMetadataPath(checkpointDirectory);
    const metadataFileContents = await readFile(metadataPath, "utf-8");
    return JSON.parse(metadataFileContents) as Checkpoint;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return null;

    throw error;
  }
};

const writeCheckpointFiles = async (
  checkpointDraft: CheckpointDraft,
): Promise<Checkpoint["files"]> => {
  await mkdir(checkpointDraft.filesDir, { recursive: true });
  const files = [];
  for (const repoPath of checkpointDraft.resolvedPaths)
    files.push(await snapshotFile(repoPath, checkpointDraft.filesDir));
  return files;
};

const persistCheckpoint = async (
  checkpointDraft: CheckpointDraft,
  files: Checkpoint["files"],
): Promise<Checkpoint> => {
  const checkpoint = createCheckpointFromDraft(checkpointDraft, files);
  await writeFile(
    readCheckpointMetadataPath(checkpointDraft.checkpointDir),
    JSON.stringify(checkpoint, null, 2),
    "utf-8",
  );
  return checkpoint;
};

const readCheckpointDirectoryListing = async (storeRoot: string): Promise<Dirent[]> => {
  try {
    return await readdir(storeRoot, { withFileTypes: true });
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return [];

    throw error;
  }
};

const tryReadCheckpointSummary = async (
  storeRoot: string,
  line: Dirent,
): Promise<CheckpointSummary | null> => {
  const isNotDirectory = !line.isDirectory();
  if (isNotDirectory) return null;

  const checkpointDirectory = join(storeRoot, line.name);
  const checkpoint = await readCheckpoint(checkpointDirectory);

  const isCheckpointMissing = checkpoint == null;
  if (isCheckpointMissing) return null;

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
  lines: Dirent[],
): Promise<CheckpointSummary[]> => {
  const checkpoints: CheckpointSummary[] = [];
  for (const line of lines) {
    const summary = await tryReadCheckpointSummary(storeRoot, line);

    const hasSummary = summary != null;
    if (hasSummary) checkpoints.push(summary);
  }
  return checkpoints;
};

const sortCheckpointSummaries = (checkpoints: CheckpointSummary[]): CheckpointSummary[] => {
  return checkpoints.sort((left, right) => {
    const byCreatedAt = right.createdAt.localeCompare(left.createdAt);
    const isCreatedAtDifferent = byCreatedAt !== 0;
    if (isCreatedAtDifferent) return byCreatedAt;

    return right.id.localeCompare(left.id);
  });
};

const restoreExistingFile = async (details: {
  repoRoot: string;
  checkpointDir: string;
  file: CheckpointFileSnapshot;
  target: RepoPath;
  restored: string[];
}): Promise<void> => {
  if (details.file.snapshotRef == null) {
    throw new Error(`Checkpoint file is missing snapshot data: ${details.file.relativePath}`);
  }

  const snapshotRelativePath = join("files", details.file.snapshotRef);
  const snapshotPath = readPathInside(details.checkpointDir, snapshotRelativePath);
  const messages = await readFile(snapshotPath);
  const targetDirectory = dirname(details.target.absolutePath);
  await mkdir(targetDirectory, { recursive: true });
  await writeFile(details.target.absolutePath, messages);
  details.restored.push(details.target.relativePath);
};

const restoreFile = async (details: {
  repoRoot: string;
  checkpointDir: string;
  file: CheckpointFileSnapshot;
  restored: string[];
  removed: string[];
}): Promise<void> => {
  const target = readRepositorySnapshotPath(details.repoRoot, details.file.relativePath);

  if (details.file.exists) {
    await restoreExistingFile({ ...details, target });
    return;
  }

  await rm(target.absolutePath, { force: true });
  details.removed.push(target.relativePath);
};

const validateSelectedPaths = (checkpoint: Checkpoint, selectedPaths: Set<string> | null): void => {
  const isSelectedPathsMissing = selectedPaths == null;
  if (isSelectedPathsMissing) return;

  for (const selectedPath of selectedPaths) {
    const isPathNotInCheckpoint = !checkpoint.files.some(
      (file) => file.relativePath === selectedPath,
    );
    if (isPathNotInCheckpoint) {
      throw new Error(`Checkpoint does not include path: ${selectedPath}`);
    }
  }
};

const restoreAllFiles = async (details: {
  repoRoot: string;
  checkpointDir: string;
  checkpoint: Checkpoint;
  selectedPaths: Set<string> | null;
}): Promise<RestoreCheckpointReport> => {
  const restored: string[] = [];
  const removed: string[] = [];
  for (const file of details.checkpoint.files) {
    if (details.selectedPaths != null && !details.selectedPaths.has(file.relativePath)) {
      continue;
    }

    await restoreFile({
      repoRoot: details.repoRoot,
      checkpointDir: details.checkpointDir,
      file,
      restored,
      removed,
    });
  }
  validateSelectedPaths(details.checkpoint, details.selectedPaths);
  return { checkpointId: details.checkpoint.id, restored, removed };
};

export const createCheckpoint = async (settings: CreateCheckpointSettings): Promise<Checkpoint> => {
  const checkpointDraft = readCheckpointDraft(settings);
  const files = await writeCheckpointFiles(checkpointDraft);
  return persistCheckpoint(checkpointDraft, files);
};

export const listCheckpoints = async (
  settings: ListCheckpointsSettings,
): Promise<CheckpointSummary[]> => {
  const storeRoot = readCheckpointStorageRoot(settings.repoRoot, settings.checkpointRoot);
  const summaries = await collectCheckpointSummaries(
    storeRoot,
    await readCheckpointDirectoryListing(storeRoot),
  );
  return sortCheckpointSummaries(summaries);
};

export const restoreCheckpoint = async (
  settings: RestoreCheckpointSettings,
): Promise<RestoreCheckpointReport> => {
  const repoRoot = resolve(settings.repoRoot);
  const checkpointDirectory = join(
    readCheckpointStorageRoot(repoRoot, settings.checkpointRoot),
    settings.checkpointId,
  );
  const checkpoint = await readCheckpoint(checkpointDirectory);

  const isCheckpointMissing = checkpoint == null;
  if (isCheckpointMissing) {
    throw new Error(`Checkpoint not found: ${settings.checkpointId}`);
  }

  return restoreAllFiles({
    repoRoot,
    checkpointDir: checkpointDirectory,
    checkpoint,
    selectedPaths: readSelectedRelativePaths(repoRoot, settings.paths),
  });
};
