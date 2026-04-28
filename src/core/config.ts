import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { BridgeConfig } from "../types/types.ts";

const CONFIG_DIR = join(homedir(), ".chatgpt-bridge");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

const DEFAULT_CONFIG: BridgeConfig = {
  repoPath: process.cwd(),
  mcpPort: 8765,
  contextLimit: 128_000,
  permissionMode: "auto",
};

/** Load config from disk, falling back to defaults for missing fields. */
export async function loadConfig(overrides?: Partial<BridgeConfig>): Promise<BridgeConfig> {
  let file: Partial<BridgeConfig> = {};
  try {
    const raw = await readFile(CONFIG_PATH, "utf-8");
    file = JSON.parse(raw);
  } catch {
    // first run — no config file yet
  }
  return { ...DEFAULT_CONFIG, ...file, ...overrides };
}

/** Persist config to disk so the next session reuses it. */
export async function saveConfig(cfg: BridgeConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}
