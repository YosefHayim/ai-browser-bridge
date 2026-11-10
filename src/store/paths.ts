import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { BRIDGE_DIR_NAME, REPO_DIR_NAME } from "@/config";

export const HOOKS_FILE = "hooks.json";

// Non-Git launch directories stay as-is; only a successful rev-parse remaps to the worktree root.
export const readRepositoryRoot = (startPath = process.cwd()): string => {
  const absolutePath = resolve(startPath);
  try {
    const gitRoot = execFileSync("git", ["-C", absolutePath, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    const isGitRootEmpty = gitRoot.length === 0;
    if (isGitRootEmpty) return absolutePath;

    return resolve(gitRoot);
  } catch {
    return absolutePath;
  }
};

export const readRepositoryPath = (repoRoot: string, path: string): string => {
  const absolutePath = resolve(repoRoot, path);

  const absoluteRoot = resolve(repoRoot);
  const isInsideRoot = absolutePath === absoluteRoot || absolutePath.startsWith(`${absoluteRoot}/`);
  if (isInsideRoot) {
    return absolutePath;
  }

  throw new Error(`Path escapes repo root: ${path}`);
};

export const readBridgeDir = (repoPath: string): string => {
  return join(repoPath, REPO_DIR_NAME);
};

export const readConfigPath = (repoPath: string): string => {
  const bridgeDir = readBridgeDir(repoPath);
  return join(bridgeDir, "config.json");
};

export const readLogsDir = (repoPath: string): string => {
  const bridgeDir = readBridgeDir(repoPath);
  return join(bridgeDir, "logs");
};

export const readSessionsDir = (repoPath: string): string => {
  const bridgeDir = readBridgeDir(repoPath);
  return join(bridgeDir, "sessions");
};

export const readCheckpointsDir = (repoPath: string): string => {
  const bridgeDir = readBridgeDir(repoPath);
  return join(bridgeDir, "checkpoints");
};

export const readExportsDir = (repoPath: string): string => {
  const bridgeDir = readBridgeDir(repoPath);
  return join(bridgeDir, "exports");
};

export const readScreenshotsDir = (repoPath: string): string => {
  const bridgeDir = readBridgeDir(repoPath);
  return join(bridgeDir, "screenshots");
};

export const readDownloadsDir = (repoPath: string): string => {
  const bridgeDir = readBridgeDir(repoPath);
  return join(bridgeDir, "downloads");
};

export const ensureBridgeDir = async (repoPath: string): Promise<string> => {
  const repositoryRoot = readRepositoryRoot(repoPath);
  const bridgeRoot = readBridgeDir(repositoryRoot);
  await mkdir(bridgeRoot, { recursive: true });
  return bridgeRoot;
};

const readBridgeHome = (home = homedir()): string => {
  return join(home, BRIDGE_DIR_NAME);
};

export const readAttachmentManifestsDir = (home = homedir()): string => {
  const bridgeHome = readBridgeHome(home);
  return join(bridgeHome, "attachment-manifests");
};

export const readHomeHooksPath = (home = homedir()): string => {
  const bridgeHome = readBridgeHome(home);
  return join(bridgeHome, HOOKS_FILE);
};

export const readDefaultSessionStoreDir = (): string => {
  const repositoryRoot = readRepositoryRoot();
  return readSessionsDir(repositoryRoot);
};
