import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { readBridgeChromeProfileRoot } from "./browser-profile.ts";
import type {
  CacheInventory,
  ChromeCacheFolder,
  PruneCacheDetails,
  PruneCacheReport,
} from "./browser-schemas.ts";

const CHROME_DEFAULT_PROFILE_FOLDER = "Default";

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
  { label: "Default HTTP cache", relativePath: join(CHROME_DEFAULT_PROFILE_FOLDER, "Cache") },
  { label: "Default code cache", relativePath: join(CHROME_DEFAULT_PROFILE_FOLDER, "Code Cache") },
  {
    label: "Default service worker cache",
    relativePath: join(CHROME_DEFAULT_PROFILE_FOLDER, "Service Worker", "CacheStorage"),
  },
];

export const listChromeCacheTargets = (profileRoot: string): ChromeCacheFolder[] => {
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
      ...(await readCacheStatus(target.path)),
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
      const isCacheFolderKept = !line.exists || !line.safeToPrune;
      if (isCacheFolderKept) continue;

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

const readCacheStatus = async (
  path: string,
): Promise<Pick<ChromeCacheFolder, "exists" | "bytes">> => {
  try {
    const pathStats = await stat(path);

    const isFolder = pathStats.isDirectory();
    if (isFolder) {
      return { exists: true, bytes: await readDirectorySize(path) };
    }

    return { exists: true, bytes: pathStats.size };
  } catch {
    return { exists: false, bytes: 0 };
  }
};

const readDirectorySize = async (path: string): Promise<number> => {
  const lines = await readdir(path, { withFileTypes: true });
  let size = 0;
  for (const line of lines) {
    const child = join(path, line.name);

    const isSubfolder = line.isDirectory();
    if (isSubfolder) {
      size += await readDirectorySize(child);
      continue;
    }

    const details = await stat(child);
    size += details.size;
  }
  return size;
};
