import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig, saveConfig } from "../../../src/features/bridge/loadConfig.ts";
import { bridgeDir, configPath } from "../../../src/features/store/paths.ts";

async function makeRepo(): Promise<string> {
  return mkdtemp(join(tmpdir(), "bridge-config-"));
}

describe("repo-local config", () => {
  it("returns defaults stamped with the given repo when no file exists", async () => {
    const repo = await makeRepo();
    const cfg = await loadConfig(repo);
    expect(cfg.repoPath).toBe(repo);
    expect(cfg.mcpPort).toBe(8765);
    expect(cfg.permissionMode).toBe("auto");
  });

  it("round-trips through <repo>/.bridge/config.json", async () => {
    const repo = await makeRepo();
    const base = await loadConfig(repo);
    await saveConfig({ ...base, mcpPort: 9000, model: "GPT-5.2", permissionMode: "ask" });

    expect(await readFile(configPath(repo), "utf-8")).toContain("9000");
    const reloaded = await loadConfig(repo);
    expect(reloaded.mcpPort).toBe(9000);
    expect(reloaded.model).toBe("GPT-5.2");
    expect(reloaded.permissionMode).toBe("ask");
  });

  it("forces repoPath from the argument, ignoring a stale value in the file", async () => {
    const repo = await makeRepo();
    await mkdir(bridgeDir(repo), { recursive: true });
    await writeFile(
      configPath(repo),
      JSON.stringify({ repoPath: "/old/stale/path", mcpPort: 7000 }),
    );

    const cfg = await loadConfig(repo);
    expect(cfg.repoPath).toBe(repo);
    expect(cfg.mcpPort).toBe(7000);
  });
});
