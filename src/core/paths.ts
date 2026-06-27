import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * On-disk locations for bridge state.
 *
 * Runtime state — sessions, logs, checkpoints, exports, screenshots, config, and
 * the signed-in Chrome profile — is scoped to the *target repo* the bridge drives
 * ChatGPT against, under `<repo>/.bridge/`. See
 * `docs/adr/0001-repo-local-state.md`. That directory self-ignores via an
 * auto-written `.gitignore` (see {@link ensureBridgeDir}), so transcripts and the
 * login cookies can never be committed even though they live inside the repo.
 *
 * A separate machine-global home (`~/.chatgpt-local-bridge/`) still holds purely
 * user-authored config meant to apply across every repo: custom commands and the
 * user-level hooks file. Those are opt-in and never written automatically.
 */

/** Repo-local bridge directory name (e.g. `<repo>/.bridge`). */
export const REPO_DIR_NAME = ".bridge";

/** Machine-global home directory name for user-authored cross-repo config. */
export const BRIDGE_DIR_NAME = ".chatgpt-local-bridge";

/** Absolute repo-local `.bridge` directory for a target repo. */
export function bridgeDir(repoPath: string): string {
  return join(repoPath, REPO_DIR_NAME);
}

/** Per-repo persisted config file. */
export function configPath(repoPath: string): string {
  return join(bridgeDir(repoPath), "config.json");
}

/** Per-repo bridge activity log directory (date-stamped JSONL). */
export function logsDir(repoPath: string): string {
  return join(bridgeDir(repoPath), "logs");
}

/** Per-repo session store (one subdirectory per session). */
export function sessionsDir(repoPath: string): string {
  return join(bridgeDir(repoPath), "sessions");
}

/** Per-repo checkpoint store for MCP-patch rollbacks. */
export function checkpointsDir(repoPath: string): string {
  return join(bridgeDir(repoPath), "checkpoints");
}

/** Per-repo default location for `/export` output. */
export function exportsDir(repoPath: string): string {
  return join(bridgeDir(repoPath), "exports");
}

/** Per-repo screenshot output directory. */
export function screenshotsDir(repoPath: string): string {
  return join(bridgeDir(repoPath), "screenshots");
}

/**
 * Isolated Chrome user-data directory holding the signed-in ChatGPT session.
 *
 * The bridge owns this directory outright rather than reusing the user's real
 * Chrome profile: Chrome ≥136 refuses to open a remote-debug port when the
 * requested user-data-dir is already in use by another Chrome process, and
 * copying the real profile corrupts session cookies on launch. A dedicated
 * persistent dir sidesteps both — the user signs in once per repo and the
 * session survives bridge restarts.
 */
export function chromeProfileDir(repoPath: string): string {
  return join(bridgeDir(repoPath), "chrome-profile");
}

/**
 * Create `<repo>/.bridge` and (re)assert its self-ignoring `.gitignore`.
 *
 * The file is a single `*`, which makes git ignore everything in the directory —
 * this file, the session transcripts, and the login cookies included — so none of
 * it can enter the (public) repo. Called once at engine startup and force-rewritten
 * so a deleted or tampered ignore file heals on the next run.
 */
export async function ensureBridgeDir(repoPath: string): Promise<string> {
  const dir = bridgeDir(repoPath);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, ".gitignore"), "*\n", "utf-8");
  return dir;
}

// ---- Machine-global home: user-authored cross-repo config only ----

/** Absolute machine-global bridge home for a given OS home directory. */
export function bridgeHome(home = homedir()): string {
  return join(home, BRIDGE_DIR_NAME);
}

/** Filename for hook config, shared by the repo's `.bridge/` dir and the home dir. */
export const HOOKS_FILE = "hooks.json";

/** Path to the user-level hooks config, honouring an injected home dir for tests. */
export function homeHooksPath(home = homedir()): string {
  return join(bridgeHome(home), HOOKS_FILE);
}
