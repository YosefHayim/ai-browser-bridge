import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** Repo-local bridge directory name (e.g. `<repo>/.bridge`). */
export const REPO_DIR_NAME = ".bridge";

/** Machine-global home directory name for user-authored cross-repo config. */
export const BRIDGE_DIR_NAME = ".ai-browser-bridge";

/** Filename for hook config shared by repo and home directories. */
export const HOOKS_FILE = "hooks.json";

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
 * Create `<repo>/.bridge` and assert its self-ignoring `.gitignore`.
 *
 * @param repoPath - Repository path used for bridge state.
 * @returns The `ensureBridgeDir` result.
 * @example
 * ```ts
 * const result = await ensureBridgeDir(repoPath);
 * ```
 */
export const ensureBridgeDir = async (repoPath: string): Promise<string> => {
  const dir = bridgeDir(repoPath);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, ".gitignore"), "*\n", "utf-8");
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
 * Default sessions directory for the current working directory.
 *
 * @returns The `defaultSessionStoreDir` result.
 * @example
 * ```ts
 * const result = defaultSessionStoreDir();
 * ```
 */
export const defaultSessionStoreDir = (): string => {
  return sessionsDir(process.cwd());
};
