import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readBridgeDirectory, readSettingsPath } from "@/store/paths.ts";
import { loadSettings, saveSettings } from "./load-config.ts";

const createTemporaryRepo = async (): Promise<string> => {
  return mkdtemp(join(tmpdir(), "bridge-config-"));
};

describe("repo-local config", () => {
  it("returns defaults stamped with the given repo when no file exists", async () => {
    const repo = await createTemporaryRepo();
    const settings = await loadSettings(repo);
    expect(settings.repoPath).toBe(repo);
    expect(settings.mcpPort).toBe(8765);
    expect(settings.permissionMode).toBe("auto");
  });

  it("round-trips through <repo>/.bridge/config.json", async () => {
    const repo = await createTemporaryRepo();
    const defaultSettings = await loadSettings(repo);
    await saveSettings({
      ...defaultSettings,
      mcpPort: 9000,
      model: "GPT-5.2",
      permissionMode: "ask",
    });

    expect(await readFile(readSettingsPath(repo), "utf-8")).toContain("9000");
    const reloaded = await loadSettings(repo);
    expect(reloaded.mcpPort).toBe(9000);
    expect(reloaded.model).toBe("GPT-5.2");
    expect(reloaded.permissionMode).toBe("ask");
  });

  it("forces repoPath from the argument, ignoring a stale value in the file", async () => {
    const repo = await createTemporaryRepo();
    await mkdir(readBridgeDirectory(repo), { recursive: true });
    await writeFile(
      readSettingsPath(repo),
      JSON.stringify({ repoPath: "/old/stale/path", mcpPort: 7000 }),
    );

    const settings = await loadSettings(repo);
    expect(settings.repoPath).toBe(repo);
    expect(settings.mcpPort).toBe(7000);
  });

  it("loads and saves config at the Git root when launched from a nested directory", async () => {
    const repo = await createTemporaryRepo();
    const nested = join(repo, "packages", "app");
    try {
      execFileSync("git", ["init", "-q"], { cwd: repo });
      await mkdir(nested, { recursive: true });
      const repoRoot = await realpath(repo);

      const settings = await loadSettings(nested);
      expect(settings.repoPath).toBe(repoRoot);
      await saveSettings({ ...settings, mcpPort: 9123 });
      expect(await readFile(readSettingsPath(repoRoot), "utf-8")).toContain("9123");
      await expect(readFile(join(nested, ".bridge", "config.json"), "utf-8")).rejects.toMatchObject(
        { code: "ENOENT" },
      );
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});
