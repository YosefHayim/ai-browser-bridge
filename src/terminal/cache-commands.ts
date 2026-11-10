import { resolve } from "node:path";
import { readBridgeChromeProfileRoot } from "@/browser/browser-profile.ts";
import type { CacheInventory, PruneCacheReport } from "@/browser/browser-schemas.ts";
import { readBrowserStatus } from "@/browser/browser-state.ts";
import { measureChromeCache, pruneChromeCache } from "@/browser/chrome-cache.ts";
import { fail } from "./cli-failure.ts";
import { NEWLINE } from "./cli-text.ts";
import type { CacheCommandSettings } from "./cli-types.ts";

const SAFE_CACHE_TARGETS_HEADING = "Safe generated-cache targets:";

const createCacheInventory = (inventory: CacheInventory): string => {
  const lines = [
    `Chrome profile root: ${inventory.profileRoot}`,
    `Reclaimable generated cache: ${inventory.reclaimableBytes} bytes`,
    "",
    SAFE_CACHE_TARGETS_HEADING,
  ];

  for (const line of inventory.entries) {
    const exists = line.exists ? `${line.bytes} bytes` : "missing";
    lines.push(`  ${line.relativePath.padEnd(40)} ${exists}`);
  }

  return lines.join(NEWLINE);
};

const createCachePruneReport = (report: PruneCacheReport): string => {
  return [
    `Chrome profile root: ${report.profileRoot}`,
    `Mode: ${report.dryRun ? "dry-run" : "confirmed prune"}`,
    `Deleted generated cache: ${report.deletedBytes} bytes`,
    "",
    SAFE_CACHE_TARGETS_HEADING,
    ...report.entries.map((line) => {
      const status = line.exists ? `${line.bytes} bytes` : "missing";
      return `  ${line.relativePath.padEnd(40)} ${status}`;
    }),
  ].join(NEWLINE);
};

const cacheProfileRoot = (settings: CacheCommandSettings): string => {
  return settings.profile ? resolve(settings.profile) : readBridgeChromeProfileRoot();
};

export const runCacheList = async (settings: CacheCommandSettings): Promise<void> => {
  const inventory = await measureChromeCache({
    profileRoot: cacheProfileRoot(settings),
  });

  if (settings.json) process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`);
  else process.stdout.write(`${createCacheInventory(inventory)}\n`);
};

export const runCachePrune = async (settings: CacheCommandSettings): Promise<void> => {
  const dryRun = settings.dryRun == null ? !settings.yes : settings.dryRun;

  const isNotDryRun = !dryRun;
  if (isNotDryRun) await assertChromeClosedForCachePrune();

  const pruneReport = await pruneChromeCache({
    profileRoot: cacheProfileRoot(settings),
    dryRun,
    confirm: settings.yes,
  });

  if (settings.json) process.stdout.write(`${JSON.stringify(pruneReport, null, 2)}\n`);
  else process.stdout.write(`${createCachePruneReport(pruneReport)}\n`);
};

const assertChromeClosedForCachePrune = async (): Promise<void> => {
  const status = await readBrowserStatus();

  const isChromeNotRunning = !status.chromeRunning;
  if (isChromeNotRunning) return;

  fail("Quit Chrome before pruning generated cache from the shared bridge profile.");
};
