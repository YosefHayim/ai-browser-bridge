import { basename, extname, isAbsolute, relative, resolve } from "node:path";
import { ensureInsideRepo } from "../../../../tools/sandbox.ts";

/** Inputs for resolving a user path within the repo. */
export interface ResolveRepoFilePathParams {
  /** Repository root directory. */
  repoRoot: string;
  /** User-supplied relative or absolute path. */
  input: string;
}

/** Resolve a user path to a repo-relative path, rejecting escapes outside the repo. */
export function resolveRepoFilePath(params: ResolveRepoFilePathParams): string {
  if (isAbsolute(params.input)) {
    const rel = relative(resolve(params.repoRoot), resolve(params.input));
    return ensureInsideRepo(rel || ".", params.repoRoot);
  }
  return ensureInsideRepo(params.input, params.repoRoot);
}

/** Throw unless the path has a supported raster image extension. */
export function assertImagePath(path: string): void {
  const extension = extname(path).toLowerCase();
  if (![".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(extension)) {
    throw new Error(`Unsupported image type: ${basename(path)}`);
  }
}
