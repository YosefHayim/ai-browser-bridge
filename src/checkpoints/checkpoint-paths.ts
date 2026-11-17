import { createHash } from "node:crypto";
import { relative, resolve, sep } from "node:path";

export type RepoPath = {
  absolutePath: string;
  relativePath: string;
};

export function hashSha256(bytes: string | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function readPosixPath(path: string): string {
  return path.split(sep).join("/");
}

function isInsideRoot(root: string, path: string): boolean {
  const isRoot = path === root;
  const isUnderRoot = path.startsWith(root + sep);

  return isRoot || isUnderRoot;
}

export function readRepositorySnapshotPath(repoRoot: string, path: string): RepoPath {
  const normalizedRoot = resolve(repoRoot);
  const absolutePath = resolve(normalizedRoot, path);

  const isOutsideRoot = !isInsideRoot(normalizedRoot, absolutePath);
  if (isOutsideRoot) throw new Error(`Path escapes repo root: ${path}`);

  const relativeFromRoot = relative(normalizedRoot, absolutePath);
  const isRelativeFromRootEmpty = relativeFromRoot.length === 0;
  const relativePath = isRelativeFromRootEmpty ? "." : readPosixPath(relativeFromRoot);

  return { absolutePath, relativePath };
}

export function readPathInsideCheckpointStore(root: string, path: string): string {
  const normalizedRoot = resolve(root);
  const absolutePath = resolve(normalizedRoot, path);

  const isOutsideRoot = !isInsideRoot(normalizedRoot, absolutePath);
  if (isOutsideRoot) throw new Error(`Path escapes checkpoint store: ${path}`);

  return absolutePath;
}
