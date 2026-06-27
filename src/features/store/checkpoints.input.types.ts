import type { CheckpointPhase } from "./checkpoints.types.ts";

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

/** Input for computing a deterministic checkpoint id. */
export interface CheckpointIdInput {
  repoRoot: string;
  createdAt: string;
  phase: CheckpointPhase;
  label?: string;
  paths: readonly string[];
}

export type { CheckpointPhase } from "./checkpoints.types.ts";
