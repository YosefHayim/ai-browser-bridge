import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { DEFAULT_CONTEXT_LIMIT, DEFAULT_MCP_PORT, DEFAULT_PERMISSION_MODE } from "@/config";
import type { BridgeConfig } from "@/features/domain";
import { configPath, repositoryRoot } from "@/features/store";

const DEFAULT_CONFIG: Omit<BridgeConfig, "repoPath"> = {
  provider: "chatgpt",
  mcpPort: DEFAULT_MCP_PORT,
  contextLimit: DEFAULT_CONTEXT_LIMIT,
  permissionMode: DEFAULT_PERMISSION_MODE,
};

// Config is repo-local (`<repoPath>/.bridge/config.json`); repoPath locates the file.
export const loadConfig = async (
  repoPath: string,
  overrides?: Partial<BridgeConfig>,
): Promise<BridgeConfig> => {
  const repoRoot = repositoryRoot(repoPath);
  let configFromDisk: Partial<BridgeConfig> = {};
  try {
    configFromDisk = JSON.parse(await readFile(configPath(repoRoot), "utf-8"));
  } catch {
    // first run in this repo — no config file yet
  }
  return { ...DEFAULT_CONFIG, ...configFromDisk, ...overrides, repoPath: repoRoot };
};

export const saveConfig = async (config: BridgeConfig): Promise<void> => {
  const repoRoot = repositoryRoot(config.repoPath);
  const path = configPath(repoRoot);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ ...config, repoPath: repoRoot }, null, 2));
};
