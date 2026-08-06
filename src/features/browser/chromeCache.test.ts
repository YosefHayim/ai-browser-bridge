import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { chromeCacheTargets, inventoryChromeCache, pruneChromeCache } from "./chromeCache.ts";

let tempDir: string | null = null;

const tempProfileRoot = async (): Promise<string> => {
  tempDir = await mkdtemp(join(tmpdir(), "bridge-chrome-cache-"));
  return tempDir;
};

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe("chrome cache", () => {
  it("targets generated Chrome cache paths but not identity state", () => {
    const relativePaths = chromeCacheTargets("/tmp/chromeProfile").map(
      (target) => target.relativePath,
    );

    expect(relativePaths).toContain("OptGuideOnDeviceModel");
    expect(relativePaths).toContain(join("Default", "Cache"));
    expect(relativePaths).not.toContain("Default/Cookies");
    expect(relativePaths).not.toContain(join("Default", "Local Storage"));
    expect(relativePaths).not.toContain(join("Default", "IndexedDB"));
  });

  it("reports reclaimable generated cache bytes", async () => {
    const profileRoot = await tempProfileRoot();
    await writeFile(join(profileRoot, "OptGuideOnDeviceModel"), "12345");

    const inventory = await inventoryChromeCache({ profileRoot });

    expect(inventory.profileRoot).toBe(profileRoot);
    expect(inventory.reclaimableBytes).toBe(5);
    expect(inventory.entries.some((entry) => entry.exists && entry.bytes === 5)).toBe(true);
  });

  it("dry-run prune leaves generated cache files in place", async () => {
    const profileRoot = await tempProfileRoot();
    const cachePath = join(profileRoot, "component_crx_cache");
    await writeFile(cachePath, "cache");

    const pruneResult = await pruneChromeCache({ profileRoot, dryRun: true });

    expect(pruneResult.deletedBytes).toBe(0);
    expect(await readFile(cachePath, "utf8")).toBe("cache");
  });

  it("confirmed prune removes only generated cache files", async () => {
    const profileRoot = await tempProfileRoot();
    const cachePath = join(profileRoot, "extensions_crx_cache");
    const cookiePath = join(profileRoot, "Cookies");
    await writeFile(cachePath, "cache");
    await writeFile(cookiePath, "secret");

    const pruneResult = await pruneChromeCache({ profileRoot, confirm: true });

    expect(pruneResult.deletedBytes).toBe(5);
    await expect(readFile(cachePath, "utf8")).rejects.toThrow();
    expect(await readFile(cookiePath, "utf8")).toBe("secret");
  });
});
