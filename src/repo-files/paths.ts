import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { BRIDGE_DIRECTORY_NAME, REPO_DIRECTORY_NAME } from "@/app-defaults.ts";

const STDIO_IGNORED = "ignore";

export const HOOKS_FILE = "hooks.json";

// Non-Git launch directories stay as-is; only a successful rev-parse remaps to the worktree root.
export function readRepositoryRoot(startPath = process.cwd()): string {
  const absolutePath = resolve(startPath);
  try {
    const gitRoot = execFileSync("git", ["-C", absolutePath, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: [STDIO_IGNORED, "pipe", STDIO_IGNORED],
    }).trim();

    const isGitRootEmpty = gitRoot.length === 0;
    if (isGitRootEmpty) return absolutePath;

    return resolve(gitRoot);
  } catch {
    return absolutePath;
  }
}

export function readRepositoryPath(repoRoot: string, path: string): string {
  const absolutePath = resolve(repoRoot, path);

  const absoluteRoot = resolve(repoRoot);

  const isInsideRoot = absolutePath === absoluteRoot || absolutePath.startsWith(`${absoluteRoot}/`);
  if (isInsideRoot) {
    return absolutePath;
  }

  throw new Error(`Path escapes repo root: ${path}`);
}

export function readBridgeDirectory(repoPath: string): string {
  return join(repoPath, REPO_DIRECTORY_NAME);
}

export function readSettingsPath(repoPath: string): string {
  const bridgeDirectory = readBridgeDirectory(repoPath);
  return join(bridgeDirectory, "config.json");
}

export function readLogsDirectory(repoPath: string): string {
  const bridgeDirectory = readBridgeDirectory(repoPath);
  return join(bridgeDirectory, "logs");
}

export function readSessionsDirectory(repoPath: string): string {
  const bridgeDirectory = readBridgeDirectory(repoPath);
  return join(bridgeDirectory, "sessions");
}

export function readCheckpointsDirectory(repoPath: string): string {
  const bridgeDirectory = readBridgeDirectory(repoPath);
  return join(bridgeDirectory, "checkpoints");
}

export function readExportsDirectory(repoPath: string): string {
  const bridgeDirectory = readBridgeDirectory(repoPath);
  return join(bridgeDirectory, "exports");
}

export function readScreenshotsDirectory(repoPath: string): string {
  const bridgeDirectory = readBridgeDirectory(repoPath);
  return join(bridgeDirectory, "screenshots");
}

export function readDownloadsDirectory(repoPath: string): string {
  const bridgeDirectory = readBridgeDirectory(repoPath);
  return join(bridgeDirectory, "downloads");
}

export async function ensureBridgeDirectory(repoPath: string): Promise<string> {
  const repositoryRoot = readRepositoryRoot(repoPath);
  const bridgeRoot = readBridgeDirectory(repositoryRoot);
  await mkdir(bridgeRoot, { recursive: true });
  return bridgeRoot;
}

function readBridgeHome(home = homedir()): string {
  return join(home, BRIDGE_DIRECTORY_NAME);
}

export function readAttachmentManifestsDirectory(home = homedir()): string {
  const bridgeHome = readBridgeHome(home);
  return join(bridgeHome, "attachment-manifests");
}

export function readHomeHooksPath(home = homedir()): string {
  const bridgeHome = readBridgeHome(home);
  return join(bridgeHome, HOOKS_FILE);
}

export function readDefaultSessionStoreDirectory(): string {
  const repositoryRoot = readRepositoryRoot();
  return readSessionsDirectory(repositoryRoot);
}
