import { join } from "node:path";
import type { Dirent } from "node:fs";
import type { CheckpointSummary } from "./checkpoints.types.ts";
import { readCheckpoint } from "./checkpoints.snapshot.ts";

/** Context for collecting checkpoint summaries from directory entries. */
export interface CollectCheckpointSummariesContext {
  /** Checkpoint store root for one repo. */
  storeRoot: string;
  /** Directory entries under the store root. */
  entries: Dirent[];
}

/** Read summary rows for every checkpoint directory entry. */
export async function collectCheckpointSummaries(ctx: CollectCheckpointSummariesContext): Promise<CheckpointSummary[]> {
  const checkpoints: CheckpointSummary[] = [];
  for (const entry of ctx.entries) {
    const summary = await tryReadCheckpointSummary({ storeRoot: ctx.storeRoot, entry });
    if (summary) checkpoints.push(summary);
  }
  return checkpoints;
}

/** Sort checkpoints by creation time descending, then id. */
export function sortCheckpointSummaries(checkpoints: CheckpointSummary[]): CheckpointSummary[] {
  return checkpoints.sort((...args: [CheckpointSummary, CheckpointSummary]) =>
    compareCheckpointSummaries({ left: args[0], right: args[1] }));
}

/** Compare two checkpoint summaries for descending sort order. */
function compareCheckpointSummaries(input: { left: CheckpointSummary; right: CheckpointSummary }): number {
  return input.right.createdAt.localeCompare(input.left.createdAt) || input.right.id.localeCompare(input.left.id);
}

/** Context for reading one checkpoint summary. */
interface TryReadCheckpointSummaryContext {
  /** Checkpoint store root for one repo. */
  storeRoot: string;
  /** Directory entry under the store root. */
  entry: Dirent;
}

/** Read one checkpoint summary, skipping non-directories and corrupt entries. */
async function tryReadCheckpointSummary(ctx: TryReadCheckpointSummaryContext): Promise<CheckpointSummary | null> {
  if (!ctx.entry.isDirectory()) return null;
  const checkpoint = await readCheckpoint(join(ctx.storeRoot, ctx.entry.name));
  if (!checkpoint) return null;
  return {
    id: checkpoint.id,
    createdAt: checkpoint.createdAt,
    phase: checkpoint.phase,
    label: checkpoint.label,
    fileCount: checkpoint.files.length,
  };
}
