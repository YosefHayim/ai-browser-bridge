import { join, resolve } from "node:path";
import type { Checkpoint, CreateCheckpointOptions } from "./checkpoints.types.ts";
import {
  checkpointId,
  checkpointStorageRoot,
  defaultPhase,
  resolveRepoPath,
  uniquePaths,
} from "./checkpoints.paths.ts";

/** Context built while preparing a createCheckpoint call. */
export interface CreateCheckpointBuildContext {
  repoRoot: string;
  createdAt: string;
  phase: ReturnType<typeof defaultPhase>;
  label?: string;
  resolvedPaths: ReturnType<typeof resolveRepoPath>[];
  checkpointDir: string;
  filesDir: string;
  id: string;
}

/** Build checkpoint id and storage paths from resolved file paths. */
function buildCheckpointPaths(ctx: {
  repoRoot: string;
  createdAt: string;
  phase: ReturnType<typeof defaultPhase>;
  label?: string;
  resolvedPaths: ReturnType<typeof resolveRepoPath>[];
  checkpointRoot?: string;
}) {
  const id = checkpointId({
    repoRoot: ctx.repoRoot,
    createdAt: ctx.createdAt,
    phase: ctx.phase,
    label: ctx.label,
    paths: ctx.resolvedPaths.map((entry) => entry.relativePath),
  });
  const checkpointDir = join(checkpointStorageRoot(ctx.repoRoot, ctx.checkpointRoot), id);
  return { id, checkpointDir, filesDir: join(checkpointDir, "files") };
}

/** Build context for createCheckpoint from caller options. */
export function buildCreateCheckpointContext(options: CreateCheckpointOptions): CreateCheckpointBuildContext {
  const base = buildCheckpointBase(options);
  const paths = buildCheckpointPaths({ ...base, checkpointRoot: options.checkpointRoot });
  return { ...base, ...paths };
}

/** Resolve repo root, phase, timestamp, and file paths for a checkpoint. */
function buildCheckpointBase(options: CreateCheckpointOptions) {
  const repoRoot = resolve(options.repoRoot);
  const phase = defaultPhase(options.phase);
  const createdAt = (options.now ?? new Date()).toISOString();
  const resolvedPaths = uniquePaths(options.paths).map((path) => resolveRepoPath(repoRoot, path));
  return { repoRoot, createdAt, phase, label: options.label, resolvedPaths };
}

/** Assemble the checkpoint record from build context and file snapshots. */
export function buildCheckpointRecord(ctx: CreateCheckpointBuildContext, files: Checkpoint["files"]): Checkpoint {
  return { id: ctx.id, repoRoot: ctx.repoRoot, createdAt: ctx.createdAt, phase: ctx.phase, label: ctx.label, files };
}

/** Context for building selected restore paths. */
export interface BuildSelectedPathsContext {
  repoRoot: string;
  paths: readonly string[] | undefined;
}

/** Build a set of selected relative paths for partial restore. */
export function buildSelectedPaths(ctx: BuildSelectedPathsContext) {
  if (!ctx.paths) return undefined;
  return new Set(ctx.paths.map((path) => resolveRepoPath(ctx.repoRoot, path).relativePath));
}
