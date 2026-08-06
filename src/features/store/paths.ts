import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { BRIDGE_DIR_NAME, REPO_DIR_NAME } from "@/config";

export const HOOKS_FILE = "hooks.json";

// Non-Git launch directories stay as-is; only a successful rev-parse remaps to the worktree root.
export const repositoryRoot = (startPath = process.cwd()): string => {
  const absolutePath = resolve(startPath);
  try {
    const gitRoot = execFileSync("git", ["-C", absolutePath, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (gitRoot.length === 0) return absolutePath;
    return resolve(gitRoot);
  } catch {
    return absolutePath;
  }
};

export const repositoryPath = (repoRoot: string, path: string): string => {
  const absolutePath = resolve(repoRoot, path);
  const absoluteRoot = resolve(repoRoot);
  if (absolutePath === absoluteRoot || absolutePath.startsWith(`${absoluteRoot}/`)) {
    return absolutePath;
  }
  throw new Error(`Path escapes repo root: ${path}`);
};

export const bridgeDir = (repoPath: string): string => {
  return join(repoPath, REPO_DIR_NAME);
};

export const configPath = (repoPath: string): string => {
  return join(bridgeDir(repoPath), "config.json");
};

export const logsDir = (repoPath: string): string => {
  return join(bridgeDir(repoPath), "logs");
};

export const sessionsDir = (repoPath: string): string => {
  return join(bridgeDir(repoPath), "sessions");
};

export const checkpointsDir = (repoPath: string): string => {
  return join(bridgeDir(repoPath), "checkpoints");
};

export const exportsDir = (repoPath: string): string => {
  return join(bridgeDir(repoPath), "exports");
};

export const screenshotsDir = (repoPath: string): string => {
  return join(bridgeDir(repoPath), "screenshots");
};

export const downloadsDir = (repoPath: string): string => {
  return join(bridgeDir(repoPath), "downloads");
};

export const ensureBridgeDir = async (repoPath: string): Promise<string> => {
  const bridgeRoot = bridgeDir(repositoryRoot(repoPath));
  await mkdir(bridgeRoot, { recursive: true });
  return bridgeRoot;
};

export const bridgeHome = (home = homedir()): string => {
  return join(home, BRIDGE_DIR_NAME);
};

export const attachmentManifestsDir = (home = homedir()): string => {
  return join(bridgeHome(home), "attachment-manifests");
};

export const homeHooksPath = (home = homedir()): string => {
  return join(bridgeHome(home), HOOKS_FILE);
};

export const defaultSessionStoreDir = (): string => {
  return sessionsDir(repositoryRoot());
};
