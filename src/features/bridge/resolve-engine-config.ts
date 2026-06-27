import type { BridgeConfig } from "../domain/types.ts";
import type { StartEngineOptions } from "./engine.types.ts";
import { loadConfig, saveConfig } from "./load-config.ts";
import { normalizeProvider } from "../providers/create-provider.factory.ts";
import { normalizePermissionMode } from "../domain/permissions.ts";
import { ensureBridgeDir } from "../store/paths.ts";

/** Default MCP server port when none is configured. */
export const DEFAULT_PORT = 8765;

/** Load, normalise, and persist the effective config for this run. */
export async function resolveEngineConfig(options: StartEngineOptions): Promise<BridgeConfig> {
  const repoPath = options.repoPath ?? process.cwd();
  await ensureBridgeDir(repoPath);
  const saved = await loadConfig(repoPath);
  const config = await loadConfig(repoPath, buildConfigOverrides({ saved, options }));
  return persistNormalisedConfig(config);
}

/** Context for building config option overrides. */
interface BuildConfigOverridesContext {
  /** Saved config from disk. */
  saved: BridgeConfig;
  /** Start engine option overrides. */
  options: StartEngineOptions;
}

/** Build option overrides for the second config load. */
function buildConfigOverrides(ctx: BuildConfigOverridesContext) {
  return {
    provider: ctx.options.provider ?? ctx.saved.provider ?? "chatgpt",
    mcpPort: ctx.options.mcpPort ?? ctx.saved.mcpPort ?? DEFAULT_PORT,
    tunnelUrl: undefined,
  };
}

/** Normalise config fields and write them back to disk. */
async function persistNormalisedConfig(config: BridgeConfig): Promise<BridgeConfig> {
  config.provider = normalizeProvider(config.provider);
  config.permissionMode = normalizePermissionMode(config.permissionMode ?? "auto");
  await saveConfig(config);
  return config;
}
