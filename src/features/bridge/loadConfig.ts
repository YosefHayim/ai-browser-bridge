import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { BridgeConfig } from "../domain/types.ts";
import { configPath } from "../store/paths.ts";

const DEFAULT_CONFIG: BridgeConfig = {
  repoPath: process.cwd(),
  provider: "chatgpt",
  mcpPort: 8765,
  contextLimit: 128_000,
  permissionMode: "auto",
};

/**
 * Load the target repo's config, falling back to defaults for missing fields.
 *
 * Config is repo-local (`<repoPath>/.bridge/config.json`), so the repo is the
 * input that locates the file — not a value read back from a global config.
 */
export async function loadConfig(
  repoPath: string,
  overrides?: Partial<BridgeConfig>,
): Promise<BridgeConfig> {
  let file: Partial<BridgeConfig> = {};
  try {
    file = JSON.parse(await readFile(configPath(repoPath), "utf-8"));
  } catch {
    // first run in this repo — no config file yet
  }
  return { ...DEFAULT_CONFIG, ...file, repoPath, ...overrides };
}

/** Persist config to the repo's `.bridge/config.json` so the next session reuses it. */
export async function saveConfig(cfg: BridgeConfig): Promise<void> {
  const path = configPath(cfg.repoPath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(cfg, null, 2));
}
