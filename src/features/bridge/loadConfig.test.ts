import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bridgeDir, configPath } from "@/features/store";
import { loadConfig, saveConfig } from "./loadConfig.ts";

const temporaryRepo = async (): Promise<string> => {
  return mkdtemp(join(tmpdir(), "bridge-config-"));
};

describe("repo-local config", () => {
  it("returns defaults stamped with the given repo when no file exists", async () => {
    const repo = await temporaryRepo();
    const config = await loadConfig(repo);
    expect(config.repoPath).toBe(repo);
    expect(config.mcpPort).toBe(8765);
    expect(config.permissionMode).toBe("auto");
  });

  it("round-trips through <repo>/.bridge/config.json", async () => {
    const repo = await temporaryRepo();
    const defaultConfig = await loadConfig(repo);
    await saveConfig({ ...defaultConfig, mcpPort: 9000, model: "GPT-5.2", permissionMode: "ask" });

    expect(await readFile(configPath(repo), "utf-8")).toContain("9000");
    const reloaded = await loadConfig(repo);
    expect(reloaded.mcpPort).toBe(9000);
    expect(reloaded.model).toBe("GPT-5.2");
    expect(reloaded.permissionMode).toBe("ask");
  });

  it("forces repoPath from the argument, ignoring a stale value in the file", async () => {
    const repo = await temporaryRepo();
    await mkdir(bridgeDir(repo), { recursive: true });
    await writeFile(
      configPath(repo),
      JSON.stringify({ repoPath: "/old/stale/path", mcpPort: 7000 }),
    );

    const config = await loadConfig(repo);
    expect(config.repoPath).toBe(repo);
    expect(config.mcpPort).toBe(7000);
  });

  it("loads and saves config at the Git root when launched from a nested directory", async () => {
    const repo = await temporaryRepo();
    const nested = join(repo, "packages", "app");
    try {
      execFileSync("git", ["init", "-q"], { cwd: repo });
      await mkdir(nested, { recursive: true });
      const repoRoot = await realpath(repo);

      const config = await loadConfig(nested);
      expect(config.repoPath).toBe(repoRoot);
      await saveConfig({ ...config, mcpPort: 9123 });
      expect(await readFile(configPath(repoRoot), "utf-8")).toContain("9123");
      await expect(readFile(join(nested, ".bridge", "config.json"), "utf-8")).rejects.toMatchObject(
        { code: "ENOENT" },
      );
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});
