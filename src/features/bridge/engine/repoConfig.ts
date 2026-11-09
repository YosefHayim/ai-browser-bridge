import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { DEFAULT_CONTEXT_LIMIT, DEFAULT_MCP_PORT, DEFAULT_PERMISSION_MODE } from "@/config.ts";
import { configPath, repositoryRoot } from "@/features/repoState/paths.ts";
import type { BridgeConfig } from "./bridgeEngineTypes.ts";

const DEFAULT_CONFIG: Omit<BridgeConfig, "repoPath"> = {
  provider: "chatgpt",
  mcpPort: DEFAULT_MCP_PORT,
  contextLimit: DEFAULT_CONTEXT_LIMIT,
  permissionMode: DEFAULT_PERMISSION_MODE,
};

// Config is repo-local (`<repoPath>/.bridge/config.json`); repoPath locates the file.
export const loadRepoConfig = async (
  repoPath: string,
  overrides?: Partial<BridgeConfig>,
): Promise<BridgeConfig> => {
  const repoRoot = repositoryRoot(repoPath);
  let persistedConfig: Partial<BridgeConfig> = {};
  try {
    const configurationPath = configPath(repoRoot);
    const configurationText = await readFile(configurationPath, "utf-8");
    persistedConfig = JSON.parse(configurationText);
  } catch {
    // first run in this repo — no config file yet
  }
  return { ...DEFAULT_CONFIG, ...persistedConfig, ...overrides, repoPath: repoRoot };
};

export const saveRepoConfig = async (config: BridgeConfig): Promise<void> => {
  const repoRoot = repositoryRoot(config.repoPath);
  const configurationPath = configPath(repoRoot);
  const configurationDirectory = dirname(configurationPath);
  const configurationText = JSON.stringify({ ...config, repoPath: repoRoot }, null, 2);
  await mkdir(configurationDirectory, { recursive: true });
  await writeFile(configurationPath, configurationText);
};
