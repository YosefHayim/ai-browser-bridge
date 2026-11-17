import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  hashSha256,
  type RepoPath,
  readPathInsideCheckpointStore,
  readRepositorySnapshotPath,
} from "@/checkpoints/checkpoint-paths.ts";
import {
  type Checkpoint,
  type CheckpointFileSnapshot,
  type CheckpointPhase,
  CheckpointSchema,
  type CheckpointSummary,
  type RestoreCheckpointReport,
} from "@/checkpoints/checkpoint-schemas.ts";
import { hasErrorCode } from "@/errors.ts";
import { readFileIfPresent } from "@/read-file-if-present.ts";
import { readCheckpointsDirectory } from "@/repo-files/paths.ts";

const FILES_FOLDER = "files";
const SHORT_DIGEST_LENGTH = 12;
const REPO_FOLDER_HASH_LENGTH = 16;
const JSON_INDENT_SPACES = 2;

export type CreateCheckpointSettings = {
  paths: readonly string[];
  phase?: CheckpointPhase;
  label?: string;
  now?: Date;
};

export type RestoreCheckpointSettings = {
  checkpointId: string;
  paths?: readonly string[];
};

type CheckpointIdParts = {
  repoRoot: string;
  createdAt: string;
  phase: CheckpointPhase;
  label?: string;
  paths: readonly string[];
};

type RestoreFileParts = {
  checkpointDirectory: string;
  file: CheckpointFileSnapshot;
  target: RepoPath;
};

type RestoreOutcome = {
  action: "restored" | "removed";
  path: string;
};

function readCheckpointId(parts: CheckpointIdParts): string {
  const timestamp = parts.createdAt.replace(/[:.]/g, "-");
  const digest = hashSha256(JSON.stringify(parts)).slice(0, SHORT_DIGEST_LENGTH);

  return `${timestamp}-${parts.phase}-${digest}`;
}

function readCheckpointMetadataPath(checkpointDirectory: string): string {
  return join(checkpointDirectory, "checkpoint.json");
}

async function tryStat(repoPath: RepoPath) {
  try {
    return await stat(repoPath.absolutePath);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return null;

    throw error;
  }
}

async function readCheckpoint(checkpointDirectory: string): Promise<Checkpoint | null> {
  const metadataPath = readCheckpointMetadataPath(checkpointDirectory);
  const json = await readFileIfPresent(metadataPath);

  const isMetadataMissing = json == null;
  if (isMetadataMissing) return null;

  const parsedJson: unknown = JSON.parse(json);
  const parsedCheckpoint = CheckpointSchema.safeParse(parsedJson);

  const isCheckpointInvalid = !parsedCheckpoint.success;
  if (isCheckpointInvalid) {
    throw new Error(`Invalid checkpoint file ${metadataPath}: ${parsedCheckpoint.error.message}`);
  }

  return parsedCheckpoint.data;
}

async function readDirectoryListing(storageDirectory: string): Promise<Dirent[]> {
  try {
    return await readdir(storageDirectory, { withFileTypes: true });
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return [];

    throw error;
  }
}

function summarizeCheckpoint(checkpoint: Checkpoint): CheckpointSummary {
  return {
    id: checkpoint.id,
    createdAt: checkpoint.createdAt,
    phase: checkpoint.phase,
    label: checkpoint.label,
    fileCount: checkpoint.files.length,
  };
}

function compareNewestFirst(left: CheckpointSummary, right: CheckpointSummary): number {
  const byCreatedAt = right.createdAt.localeCompare(left.createdAt);

  const isCreatedAtDifferent = byCreatedAt !== 0;
  if (isCreatedAtDifferent) return byCreatedAt;

  return right.id.localeCompare(left.id);
}

export class CheckpointStore {
  constructor(
    private readonly repoRoot: string,
    private readonly checkpointRoot: string = readCheckpointsDirectory(repoRoot),
  ) {}

  create = async (settings: CreateCheckpointSettings): Promise<Checkpoint> => {
    const repoRoot = resolve(this.repoRoot);
    const phase = settings.phase ?? "before";
    const createdAt = (settings.now ?? new Date()).toISOString();
    const uniquePaths = [...new Set(settings.paths)];
    const snapshotPaths = uniquePaths.map((path) => readRepositorySnapshotPath(repoRoot, path));
    const relativePaths = snapshotPaths.map((snapshotPath) => snapshotPath.relativePath);
    const id = readCheckpointId({
      repoRoot,
      createdAt,
      phase,
      label: settings.label,
      paths: relativePaths,
    });
    const checkpointDirectory = join(this.readStorageDirectory(), id);
    const filesDirectory = join(checkpointDirectory, FILES_FOLDER);

    await mkdir(filesDirectory, { recursive: true });
    const files = await this.snapshotAll(snapshotPaths, filesDirectory);
    const checkpoint = { id, repoRoot, createdAt, phase, label: settings.label, files };
    const json = JSON.stringify(checkpoint, null, JSON_INDENT_SPACES);
    await writeFile(readCheckpointMetadataPath(checkpointDirectory), json, "utf-8");

    return checkpoint;
  };

  list = async (): Promise<CheckpointSummary[]> => {
    const storageDirectory = this.readStorageDirectory();
    const lines = await readDirectoryListing(storageDirectory);
    const folderLines = lines.filter((line) => line.isDirectory());
    const checkpoints = await Promise.all(
      folderLines.map((line) => readCheckpoint(join(storageDirectory, line.name))),
    );
    const foundCheckpoints = checkpoints.filter((checkpoint) => checkpoint != null);

    return foundCheckpoints.map(summarizeCheckpoint).sort(compareNewestFirst);
  };

  restore = async (settings: RestoreCheckpointSettings): Promise<RestoreCheckpointReport> => {
    const checkpointDirectory = join(this.readStorageDirectory(), settings.checkpointId);
    const checkpoint = await readCheckpoint(checkpointDirectory);

    const isCheckpointMissing = checkpoint == null;
    if (isCheckpointMissing) throw new Error(`Checkpoint not found: ${settings.checkpointId}`);

    const selectedPaths = this.readSelectedPaths(settings.paths);
    const restored: string[] = [];
    const removed: string[] = [];
    const reportLists = { restored, removed };
    for (const file of checkpoint.files) {
      const isFileSkipped = selectedPaths != null && !selectedPaths.has(file.relativePath);
      if (isFileSkipped) continue;

      const target = readRepositorySnapshotPath(this.repoRoot, file.relativePath);
      const outcome = await this.restoreFile({ checkpointDirectory, file, target });
      reportLists[outcome.action].push(outcome.path);
    }
    this.assertSelectedPathsExist(checkpoint, selectedPaths);

    return { checkpointId: checkpoint.id, restored, removed };
  };

  private readStorageDirectory = (): string => {
    const repoFolderHash = hashSha256(resolve(this.repoRoot));

    return join(this.checkpointRoot, repoFolderHash.slice(0, REPO_FOLDER_HASH_LENGTH));
  };

  private readSelectedPaths = (paths: readonly string[] | undefined): Set<string> | null => {
    const isPathsMissing = paths == null;
    if (isPathsMissing) return null;

    const relativePaths = paths.map(
      (path) => readRepositorySnapshotPath(this.repoRoot, path).relativePath,
    );

    return new Set(relativePaths);
  };

  private assertSelectedPathsExist = (
    checkpoint: Checkpoint,
    selectedPaths: Set<string> | null,
  ): void => {
    const isSelectionMissing = selectedPaths == null;
    if (isSelectionMissing) return;

    const checkpointPaths = new Set(checkpoint.files.map((file) => file.relativePath));
    for (const selectedPath of selectedPaths) {
      const isPathNotInCheckpoint = !checkpointPaths.has(selectedPath);
      if (isPathNotInCheckpoint) {
        throw new Error(`Checkpoint does not include path: ${selectedPath}`);
      }
    }
  };

  private snapshotAll = async (
    snapshotPaths: RepoPath[],
    filesDirectory: string,
  ): Promise<CheckpointFileSnapshot[]> => {
    const files: CheckpointFileSnapshot[] = [];
    for (const repoPath of snapshotPaths) {
      const snapshottedFile = await this.snapshotFile(repoPath, filesDirectory);
      files.push(snapshottedFile);
    }

    return files;
  };

  private snapshotFile = async (
    repoPath: RepoPath,
    filesDirectory: string,
  ): Promise<CheckpointFileSnapshot> => {
    const fileStat = await tryStat(repoPath);

    const isFileStatMissing = fileStat == null;
    if (isFileStatMissing) return { relativePath: repoPath.relativePath, exists: false, size: 0 };

    const isDirectory = fileStat.isDirectory();
    if (isDirectory) throw new Error(`Cannot checkpoint directory: ${repoPath.relativePath}`);

    const isNotFile = !fileStat.isFile();
    if (isNotFile) throw new Error(`Cannot checkpoint non-file path: ${repoPath.relativePath}`);

    const bytes = await readFile(repoPath.absolutePath);
    const bytesHash = hashSha256(bytes);
    const pathHash = hashSha256(repoPath.relativePath).slice(0, SHORT_DIGEST_LENGTH);
    const snapshotRef = `${bytesHash}-${pathHash}`;
    await writeFile(join(filesDirectory, snapshotRef), bytes);

    return {
      relativePath: repoPath.relativePath,
      exists: true,
      size: Number(fileStat.size),
      sha256: bytesHash,
      snapshotRef,
    };
  };

  private restoreFile = async (parts: RestoreFileParts): Promise<RestoreOutcome> => {
    const path = parts.target.relativePath;

    const isFileAbsent = !parts.file.exists;
    if (isFileAbsent) {
      await rm(parts.target.absolutePath, { force: true });

      return { action: "removed", path };
    }

    const snapshotRef = parts.file.snapshotRef;

    const isSnapshotMissing = snapshotRef == null;
    if (isSnapshotMissing) {
      throw new Error(`Checkpoint file is missing snapshot data: ${parts.file.relativePath}`);
    }

    const snapshotRelativePath = join(FILES_FOLDER, snapshotRef);
    const snapshotPath = readPathInsideCheckpointStore(
      parts.checkpointDirectory,
      snapshotRelativePath,
    );
    const bytes = await readFile(snapshotPath);
    await mkdir(dirname(parts.target.absolutePath), { recursive: true });
    await writeFile(parts.target.absolutePath, bytes);

    return { action: "restored", path };
  };
}
