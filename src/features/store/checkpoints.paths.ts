import { createHash } from "node:crypto";
import { join, relative, resolve, sep } from "node:path";
import { checkpointsDir } from "./paths.ts";
import type { CheckpointIdInput, CheckpointPhase, RepoPath } from "./checkpoints.types.ts";

/** Compute SHA-256 hex digest of a string or buffer. */
export function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Convert a platform path to POSIX separators. */
export function toPosixPath(path: string): string {
  return path.split(sep).join("/");
}

/** Resolve the per-repository checkpoint store path. */
export function checkpointStorageRoot(repoRoot: string, checkpointRoot = checkpointsDir(repoRoot)): string {
  return join(checkpointRoot, sha256(resolve(repoRoot)).slice(0, 16));
}

/** Path to `checkpoint.json` inside a checkpoint directory. */
export function metadataPath(checkpointDir: string): string {
  return join(checkpointDir, "checkpoint.json");
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

/** Resolve a path and ensure it stays inside a root directory. */
export function resolveInside(root: string, path: string): string {
  const normalizedRoot = resolve(root);
  const resolved = resolve(normalizedRoot, path);
  if (resolved !== normalizedRoot && !resolved.startsWith(normalizedRoot + sep)) {
    throw new Error(`Path escapes checkpoint store: ${path}`);
  }
  return resolved;
}

/** Deduplicate path strings preserving first-seen order. */
export function uniquePaths(paths: readonly string[]): string[] {
  return [...new Set(paths)];
}

/** Build a deterministic checkpoint directory name. */
export function checkpointId(input: CheckpointIdInput): string {
  const timestamp = input.createdAt.replace(/[:.]/g, "-");
  const digest = sha256(JSON.stringify(input)).slice(0, 12);
  return `${timestamp}-${input.phase}-${digest}`;
}

/** Default checkpoint phase when omitted. */
export function defaultPhase(phase?: CheckpointPhase): CheckpointPhase {
  return phase ?? "before";
}
