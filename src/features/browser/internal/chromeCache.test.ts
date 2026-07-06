import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { chromeCacheTargets, inventoryChromeCache, pruneChromeCache } from "./chromeCache.ts";

let tempDir: string | null = null;

const makeProfile = async (): Promise<string> => {
  tempDir = await mkdtemp(join(tmpdir(), "bridge-chrome-cache-"));
  return tempDir;
};

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe("chrome cache helpers", () => {
  it("targets generated Chrome cache paths but not identity state", () => {
    const targets = chromeCacheTargets("/tmp/chromeProfile").map((target) => target.relativePath);

    expect(targets).toContain("OptGuideOnDeviceModel");
    expect(targets).toContain(join("Default", "Cache"));
    expect(targets).not.toContain("Default/Cookies");
    expect(targets).not.toContain(join("Default", "Local Storage"));
    expect(targets).not.toContain(join("Default", "IndexedDB"));
  });

  it("reports reclaimable generated cache bytes", async () => {
    const profile = await makeProfile();
    await writeFile(join(profile, "OptGuideOnDeviceModel"), "12345");

    const inventory = await inventoryChromeCache({ profileRoot: profile });

    expect(inventory.profileRoot).toBe(profile);
    expect(inventory.reclaimableBytes).toBe(5);
    expect(inventory.entries.some((entry) => entry.exists && entry.bytes === 5)).toBe(true);
  });

  it("dry-run prune leaves generated cache files in place", async () => {
    const profile = await makeProfile();
    const target = join(profile, "component_crx_cache");
    await writeFile(target, "cache");

    const result = await pruneChromeCache({ profileRoot: profile, dryRun: true });

    expect(result.deletedBytes).toBe(0);
    expect(await readFile(target, "utf8")).toBe("cache");
  });

  it("confirmed prune removes only generated cache files", async () => {
    const profile = await makeProfile();
    const cache = join(profile, "extensions_crx_cache");
    const cookie = join(profile, "Cookies");
    await writeFile(cache, "cache");
    await writeFile(cookie, "secret");

    const result = await pruneChromeCache({ profileRoot: profile, confirm: true });

    expect(result.deletedBytes).toBe(5);
    await expect(readFile(cache, "utf8")).rejects.toThrow();
    expect(await readFile(cookie, "utf8")).toBe("secret");
  });
});
