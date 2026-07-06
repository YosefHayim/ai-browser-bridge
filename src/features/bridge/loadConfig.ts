import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { DEFAULT_CONTEXT_LIMIT, DEFAULT_MCP_PORT, DEFAULT_PERMISSION_MODE } from "@/config";
import type { BridgeConfig } from "@/features/domain";
import { configPath } from "@/features/store";

const DEFAULT_CONFIG: BridgeConfig = {
  repoPath: process.cwd(),
  provider: "chatgpt",
  mcpPort: DEFAULT_MCP_PORT,
  contextLimit: DEFAULT_CONTEXT_LIMIT,
  permissionMode: DEFAULT_PERMISSION_MODE,
};

/**
 * Load the target repo's config, falling back to defaults for missing fields.
 *
 * Config is repo-local (`<repoPath>/.bridge/config.json`), so the repo is the
 * input that locates the file — not a value read back from a global config.
 *
 * @param repoPath - Repository path used for bridge state.
 * @param overrides - Overrides value.
 * @returns The `loadConfig` result.
 * @example
 * ```ts
 * const result = await loadConfig(repoPath, overrides);
 * ```
 */
export const loadConfig = async (
  repoPath: string,
  overrides?: Partial<BridgeConfig>,
): Promise<BridgeConfig> => {
  let file: Partial<BridgeConfig> = {};
  try {
    file = JSON.parse(await readFile(configPath(repoPath), "utf-8"));
  } catch {
    // first run in this repo — no config file yet
  }
  return { ...DEFAULT_CONFIG, ...file, repoPath, ...overrides };
};

/**
 * Persist config to the repo's `.bridge/config.json` so the next session reuses it.
 *
 * @param cfg - Cfg value.
 * @returns Completes when `saveConfig` finishes.
 * @example
 * ```ts
 * await saveConfig(cfg);
 * ```
 */
export const saveConfig = async (cfg: BridgeConfig): Promise<void> => {
  const path = configPath(cfg.repoPath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(cfg, null, 2));
};
