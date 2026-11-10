import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { DEFAULT_CONTEXT_LIMIT, DEFAULT_MCP_PORT, DEFAULT_PERMISSION_MODE } from "@/config";
import type { BridgeConfig } from "@/domain/bridge-types.ts";
import { readConfigPath, readRepositoryRoot } from "@/store/paths.ts";

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
  const repoRoot = readRepositoryRoot(repoPath);
  let configFromDisk: Partial<BridgeConfig> = {};
  try {
    const configPath = readConfigPath(repoRoot);
    const configFileText = await readFile(configPath, "utf-8");
    configFromDisk = JSON.parse(configFileText);
  } catch {
    // first run in this repo — no config file yet
  }
  return { ...DEFAULT_CONFIG, ...configFromDisk, ...overrides, repoPath: repoRoot };
};

export const saveConfig = async (config: BridgeConfig): Promise<void> => {
  const repoRoot = readRepositoryRoot(config.repoPath);
  const path = readConfigPath(repoRoot);
  const parentFolder = dirname(path);
  await mkdir(parentFolder, { recursive: true });
  const configText = JSON.stringify({ ...config, repoPath: repoRoot }, null, 2);
  await writeFile(path, configText);
};
