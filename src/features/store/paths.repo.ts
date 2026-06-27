import { join } from "node:path";
import type { BridgeProviderId } from "../providers/create-provider.factory.ts";
import { REPO_DIR_NAME } from "./paths.constants.ts";

/** Absolute repo-local `.bridge` directory for a target repo. */
export function bridgeDir(repoPath: string): string {
  return join(repoPath, REPO_DIR_NAME);
}

/** Per-repo persisted config file. */
export function configPath(repoPath: string): string {
  return join(bridgeDir(repoPath), "config.json");
}

/** Per-repo bridge activity log directory. */
export function logsDir(repoPath: string): string {
  return join(bridgeDir(repoPath), "logs");
}

/** Per-repo session store directory. */
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

interface ChromeProfileInput {
  /** Target repo path. */
  repoPath: string;
  /** Browser provider whose profile directory to resolve. */
  provider?: BridgeProviderId;
}

/** Isolated Chrome user-data directory for the signed-in provider session. */
export function chromeProfileDir(input: ChromeProfileInput | string, provider: BridgeProviderId = "chatgpt"): string {
  const repoPath = typeof input === "string" ? input : input.repoPath;
  const providerId = typeof input === "string" ? provider : input.provider ?? "chatgpt";
  const dirName = providerId === "gemini" ? "chrome-profile-gemini" : "chrome-profile";
  return join(bridgeDir(repoPath), dirName);
}
