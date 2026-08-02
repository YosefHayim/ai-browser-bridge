import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { BRIDGE_DIR_NAME, REPO_DIR_NAME } from "@/config";

/** Filename for hook config shared by repo and home directories. */
export const HOOKS_FILE = "hooks.json";

/**
 * Resolve a launch directory to the canonical Git working-tree root.
 *
 * Paths outside a Git worktree remain unchanged, which preserves support for
 * explicitly targeted non-Git directories.
 *
 * @param startPath - Directory supplied by `--repo` or the current process.
 * @returns The Git top-level directory, or the absolute input path outside Git.
 * @example
 * ```ts
 * const repoRoot = resolveRepoRoot("/repo/packages/app/src");
 * // => "/repo"
 * ```
 */
export const resolveRepoRoot = (startPath = process.cwd()): string => {
  const absolutePath = resolve(startPath);
  try {
    const gitRoot = execFileSync("git", ["-C", absolutePath, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return gitRoot ? resolve(gitRoot) : absolutePath;
  } catch {
    return absolutePath;
  }
};

/**
 * Absolute repo-local `.bridge` directory for a target repo.
 *
 * @param repoPath - Repository path used for bridge state.
 * @returns The `bridgeDir` result.
 * @example
 * ```ts
 * const result = bridgeDir(repoPath);
 * ```
 */
export const bridgeDir = (repoPath: string): string => {
  return join(repoPath, REPO_DIR_NAME);
};

/**
 * Per-repo persisted config file.
 *
 * @param repoPath - Repository path used for bridge state.
 * @returns The `configPath` result.
 * @example
 * ```ts
 * const result = configPath(repoPath);
 * ```
 */
export const configPath = (repoPath: string): string => {
  return join(bridgeDir(repoPath), "config.json");
};

/**
 * Per-repo bridge activity log directory.
 *
 * @param repoPath - Repository path used for bridge state.
 * @returns The `logsDir` result.
 * @example
 * ```ts
 * const result = logsDir(repoPath);
 * ```
 */
export const logsDir = (repoPath: string): string => {
  return join(bridgeDir(repoPath), "logs");
};

/**
 * Per-repo session store directory.
 *
 * @param repoPath - Repository path used for bridge state.
 * @returns The `sessionsDir` result.
 * @example
 * ```ts
 * const result = sessionsDir(repoPath);
 * ```
 */
export const sessionsDir = (repoPath: string): string => {
  return join(bridgeDir(repoPath), "sessions");
};

/**
 * Per-repo checkpoint store for MCP-patch rollbacks.
 *
 * @param repoPath - Repository path used for bridge state.
 * @returns The `checkpointsDir` result.
 * @example
 * ```ts
 * const result = checkpointsDir(repoPath);
 * ```
 */
export const checkpointsDir = (repoPath: string): string => {
  return join(bridgeDir(repoPath), "checkpoints");
};

/**
 * Per-repo default location for `/export` output.
 *
 * @param repoPath - Repository path used for bridge state.
 * @returns The `exportsDir` result.
 * @example
 * ```ts
 * const result = exportsDir(repoPath);
 * ```
 */
export const exportsDir = (repoPath: string): string => {
  return join(bridgeDir(repoPath), "exports");
};

/**
 * Per-repo screenshot output directory.
 *
 * @param repoPath - Repository path used for bridge state.
 * @returns The `screenshotsDir` result.
 * @example
 * ```ts
 * const result = screenshotsDir(repoPath);
 * ```
 */
export const screenshotsDir = (repoPath: string): string => {
  return join(bridgeDir(repoPath), "screenshots");
};

/**
 * Per-repo default location for downloaded assets.
 *
 * @param repoPath - Repository path used for bridge state.
 * @returns The canonical `.bridge/downloads` directory.
 * @example
 * ```ts
 * const result = downloadsDir("/repo");
 * ```
 */
export const downloadsDir = (repoPath: string): string => {
  return join(bridgeDir(repoPath), "downloads");
};

/**
 * Create the canonical Git-root `<repo>/.bridge` directory.
 *
 * @param repoPath - Launch directory or explicit repository path.
 * @returns The canonical bridge state directory.
 * @example
 * ```ts
 * const dir = await ensureBridgeDir("/repo/packages/app");
 * ```
 */
export const ensureBridgeDir = async (repoPath: string): Promise<string> => {
  const dir = bridgeDir(resolveRepoRoot(repoPath));
  await mkdir(dir, { recursive: true });
  return dir;
};

/**
 * Absolute machine-global bridge home for a given OS home directory.
 *
 * @param home - Home value.
 * @returns The `bridgeHome` result.
 * @example
 * ```ts
 * const result = bridgeHome(home);
 * ```
 */
export const bridgeHome = (home = homedir()): string => {
  return join(home, BRIDGE_DIR_NAME);
};

/**
 * Machine-global root for transient ChatGPT attachment manifests.
 *
 * @param home - Home value.
 * @returns The `attachmentManifestsDir` result.
 * @example
 * ```ts
 * const result = attachmentManifestsDir(home);
 * ```
 */
export const attachmentManifestsDir = (home = homedir()): string => {
  return join(bridgeHome(home), "attachment-manifests");
};

/**
 * Path to the user-level hooks config, honouring an injected home dir for tests.
 *
 * @param home - Home value.
 * @returns The `homeHooksPath` result.
 * @example
 * ```ts
 * const result = homeHooksPath(home);
 * ```
 */
export const homeHooksPath = (home = homedir()): string => {
  return join(bridgeHome(home), HOOKS_FILE);
};

/**
 * Default sessions directory at the current Git working-tree root.
 *
 * @returns The `defaultSessionStoreDir` result.
 * @example
 * ```ts
 * const result = defaultSessionStoreDir();
 * ```
 */
export const defaultSessionStoreDir = (): string => {
  return sessionsDir(resolveRepoRoot());
};
