import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type {
  CacheInventory,
  ChromeCacheEntry,
  PruneCacheInput,
  PruneCacheResult,
} from "../browserSchemas.ts";
import { bridgeChromeProfileRoot } from "./browserProfile.ts";

interface CacheTarget {
  readonly label: string;
  readonly relativePath: string;
}

const GENERATED_CACHE_TARGETS: readonly CacheTarget[] = [
  { label: "Optimization Guide on-device model", relativePath: "OptGuideOnDeviceModel" },
  {
    label: "Optimization Guide classifier model",
    relativePath: "OptGuideOnDeviceClassifierModel",
  },
  { label: "Optimization Guide model store", relativePath: "optimization_guide_model_store" },
  { label: "Component CRX cache", relativePath: "component_crx_cache" },
  { label: "Extension CRX cache", relativePath: "extensions_crx_cache" },
  { label: "Default HTTP cache", relativePath: join("Default", "Cache") },
  { label: "Default code cache", relativePath: join("Default", "Code Cache") },
  {
    label: "Default service worker cache",
    relativePath: join("Default", "Service Worker", "CacheStorage"),
  },
];

/**
 * Safe generated-cache targets under a Chrome profile root.
 *
 * @param profileRoot - Profile root value.
 * @returns The `chromeCacheTargets` result.
 * @example
 * ```ts
 * const result = chromeCacheTargets(profileRoot);
 * ```
 */
export const chromeCacheTargets = (profileRoot: string): ChromeCacheEntry[] => {
  return GENERATED_CACHE_TARGETS.map((target) => ({
    label: target.label,
    relativePath: target.relativePath,
    path: join(profileRoot, target.relativePath),
    exists: false,
    bytes: 0,
    safeToPrune: true,
  }));
};

/**
 * Report generated Chrome cache/model storage under a profile root.
 *
 * @param input - Input values for the operation.
 * @returns The `inventoryChromeCache` result.
 * @example
 * ```ts
 * const result = await inventoryChromeCache(input);
 * ```
 */
export const inventoryChromeCache = async (
  input: {
    profileRoot?: string;
  } = {},
): Promise<CacheInventory> => {
  const profileRoot = input.profileRoot ?? bridgeChromeProfileRoot();
  const entries = await Promise.all(
    chromeCacheTargets(profileRoot).map(async (target) => ({
      ...target,
      ...(await readCacheEntry(target.path)),
    })),
  );
  return {
    profileRoot,
    entries,
    reclaimableBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
  };
};

/**
 * Delete generated Chrome cache/model storage when explicitly confirmed.
 *
 * @param input - Input values for the operation.
 * @returns The `pruneChromeCache` result.
 * @example
 * ```ts
 * const result = await pruneChromeCache(input);
 * ```
 */
export const pruneChromeCache = async (input: PruneCacheInput): Promise<PruneCacheResult> => {
  const inventory = await inventoryChromeCache({ profileRoot: input.profileRoot });
  const dryRun = input.dryRun ?? !input.confirm;
  let deletedBytes = 0;
  if (!dryRun && input.confirm) {
    for (const entry of inventory.entries) {
      if (!entry.exists || !entry.safeToPrune) continue;
      await rm(entry.path, { recursive: true, force: true });
      deletedBytes += entry.bytes;
    }
  }
  return {
    profileRoot: inventory.profileRoot,
    dryRun,
    deletedBytes,
    entries: inventory.entries,
  };
};

const readCacheEntry = async (
  path: string,
): Promise<Pick<ChromeCacheEntry, "exists" | "bytes">> => {
  try {
    const info = await stat(path);
    return { exists: true, bytes: info.isDirectory() ? await directorySize(path) : info.size };
  } catch {
    return { exists: false, bytes: 0 };
  }
};

const directorySize = async (path: string): Promise<number> => {
  const entries = await readdir(path, { withFileTypes: true });
  let size = 0;
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) size += await directorySize(child);
    else {
      const info = await stat(child);
      size += info.size;
    }
  }
  return size;
};
