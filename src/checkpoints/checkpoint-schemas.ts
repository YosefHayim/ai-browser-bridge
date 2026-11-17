import { z } from "zod";

const CheckpointPhaseSchema = z.enum(["before", "after"]);

const CheckpointFileSnapshotSchema = z.object({
  relativePath: z.string(),
  exists: z.boolean(),
  size: z.int().nonnegative(),
  sha256: z.string().optional(),
  snapshotRef: z.string().optional(),
});

export const CheckpointSchema = z.object({
  id: z.string(),
  repoRoot: z.string(),
  createdAt: z.string(),
  phase: CheckpointPhaseSchema,
  label: z.string().optional(),
  files: z.array(CheckpointFileSnapshotSchema),
});

export type CheckpointPhase = z.infer<typeof CheckpointPhaseSchema>;

export type CheckpointFileSnapshot = z.infer<typeof CheckpointFileSnapshotSchema>;

export type Checkpoint = z.infer<typeof CheckpointSchema>;

export type CheckpointSummary = {
  id: string;
  createdAt: string;
  phase: CheckpointPhase;
  fileCount: number;
  label?: string;
};

export type RestoreCheckpointReport = {
  checkpointId: string;
  restored: string[];
  removed: string[];
};
