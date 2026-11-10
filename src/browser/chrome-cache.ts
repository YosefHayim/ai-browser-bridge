import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { readBridgeChromeProfileRoot } from "./browser-profile.ts";
import type {
  CacheInventory,
  ChromeCacheLine,
  PruneCacheDetails,
  PruneCacheReport,
} from "./browser-schemas.ts";

type CacheTarget = {
  readonly label: string;
  readonly relativePath: string;
};

// Generated-cache targets only — identity state (cookies, storage) is never listed.
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

export const listChromeCacheTargets = (profileRoot: string): ChromeCacheLine[] => {
  return GENERATED_CACHE_TARGETS.map((target) => ({
    label: target.label,
    relativePath: target.relativePath,
    path: join(profileRoot, target.relativePath),
    exists: false,
    bytes: 0,
    safeToPrune: true,
  }));
};

export const measureChromeCache = async (
  details: { readonly profileRoot?: string } = {},
): Promise<CacheInventory> => {
  let profileRoot = readBridgeChromeProfileRoot();
  const hasProfileRoot = details.profileRoot != null;
  if (hasProfileRoot) {
    profileRoot = details.profileRoot;
  }

  const lines = await Promise.all(
    listChromeCacheTargets(profileRoot).map(async (target) => ({
      ...target,
      ...(await readCacheLine(target.path)),
    })),
  );
  return {
    profileRoot,
    entries: lines,
    reclaimableBytes: lines.reduce((sum, line) => sum + line.bytes, 0),
  };
};

export const pruneChromeCache = async (details: PruneCacheDetails): Promise<PruneCacheReport> => {
  const inventory = await measureChromeCache({ profileRoot: details.profileRoot });

  let dryRun = details.confirm !== true;
  const hasDryRun = details.dryRun != null;
  if (hasDryRun) {
    dryRun = details.dryRun;
  }

  let deletedBytes = 0;

  const isConfirmedRealRun = !dryRun && details.confirm;
  if (isConfirmedRealRun) {
    for (const line of inventory.entries) {
      const isLineNotPrunable = !line.exists || !line.safeToPrune;
      if (isLineNotPrunable) continue;

      await rm(line.path, { recursive: true, force: true });
      deletedBytes += line.bytes;
    }
  }

  return {
    profileRoot: inventory.profileRoot,
    dryRun,
    deletedBytes,
    entries: inventory.entries,
  };
};

const readCacheLine = async (path: string): Promise<Pick<ChromeCacheLine, "exists" | "bytes">> => {
  try {
    const details = await stat(path);
    const isDirectoryDetails = details.isDirectory();
    if (isDirectoryDetails) {
      return { exists: true, bytes: await readDirectorySize(path) };
    }

    return { exists: true, bytes: details.size };
  } catch {
    return { exists: false, bytes: 0 };
  }
};

const readDirectorySize = async (path: string): Promise<number> => {
  const lines = await readdir(path, { withFileTypes: true });
  let size = 0;
  for (const line of lines) {
    const child = join(path, line.name);

    const isDirectoryLine = line.isDirectory();
    if (isDirectoryLine) {
      size += await readDirectorySize(child);
      continue;
    }

    const details = await stat(child);
    size += details.size;
  }
  return size;
};
