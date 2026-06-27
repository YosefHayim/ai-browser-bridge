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
export interface RepoPath {
  absolutePath: string;
  relativePath: string;
}

export type {
  CheckpointIdInput,
  CreateCheckpointOptions,
  ListCheckpointsOptions,
  RestoreCheckpointOptions,
  RestoreCheckpointResult,
} from "./checkpoints.input.types.ts";
