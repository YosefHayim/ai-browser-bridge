import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { DEFAULT_MCP_PORT, DEFAULT_PERMISSION_MODE, DEFAULT_TOKEN_LIMIT } from "@/config";
import type { BridgeSettings } from "@/domain/bridge-types.ts";
import { readRepositoryRoot, readSettingsPath } from "@/store/paths.ts";

const DEFAULT_SETTINGS: Omit<BridgeSettings, "repoPath"> = {
  provider: "chatgpt",
  mcpPort: DEFAULT_MCP_PORT,
  contextLimit: DEFAULT_TOKEN_LIMIT,
  permissionMode: DEFAULT_PERMISSION_MODE,
};

// Config is repo-local (`<repoPath>/.bridge/config.json`); repoPath locates the file.
export const loadSettings = async (
  repoPath: string,
  overrides?: Partial<BridgeSettings>,
): Promise<BridgeSettings> => {
  const repoRoot = readRepositoryRoot(repoPath);
  let settingsFromDisk: Partial<BridgeSettings> = {};

  try {
    const settingsPath = readSettingsPath(repoRoot);
    const serializedSettings = await readFile(settingsPath, "utf-8");
    settingsFromDisk = JSON.parse(serializedSettings);
  } catch {
    // first run in this repo — no config file yet
  }

  return { ...DEFAULT_SETTINGS, ...settingsFromDisk, ...overrides, repoPath: repoRoot };
};

export const saveSettings = async (settings: BridgeSettings): Promise<void> => {
  const repoRoot = readRepositoryRoot(settings.repoPath);
  const path = readSettingsPath(repoRoot);
  const parentFolder = dirname(path);

  await mkdir(parentFolder, { recursive: true });

  const indentSpaces = 2;

  const serializedSettings = JSON.stringify(
    { ...settings, repoPath: repoRoot },
    null,
    indentSpaces,
  );

  await writeFile(path, serializedSettings);
};
