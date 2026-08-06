import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  bridgeDir,
  configPath,
  downloadsDir,
  ensureBridgeDir,
  logsDir,
  repositoryPath,
  repositoryRoot,
  sessionsDir,
} from "./paths.ts";

describe("repo-local path resolution", () => {
  it("keeps repository paths inside the repository root", () => {
    expect(repositoryPath("/my/repo", "src/index.ts")).toBe("/my/repo/src/index.ts");
    expect(repositoryPath("/my/repo", ".")).toBe("/my/repo");
    expect(() => repositoryPath("/my/repo", "../../etc/passwd")).toThrow("Path escapes repo root");
  });

  it("scopes every state location under <repo>/.bridge", () => {
    const repo = "/tmp/example-repo";
    expect(bridgeDir(repo)).toBe("/tmp/example-repo/.bridge");
    expect(configPath(repo)).toBe("/tmp/example-repo/.bridge/config.json");
    expect(logsDir(repo)).toBe("/tmp/example-repo/.bridge/logs");
    expect(sessionsDir(repo)).toBe("/tmp/example-repo/.bridge/sessions");
    expect(downloadsDir(repo)).toBe("/tmp/example-repo/.bridge/downloads");
  });

  it("resolves a nested launch directory to its Git working-tree root", async () => {
    const repo = await mkdtemp(join(tmpdir(), "bridge-root-"));
    const nested = join(repo, "packages", "app", "src");
    try {
      execFileSync("git", ["init", "-q"], { cwd: repo });
      await mkdir(nested, { recursive: true });
      const repoRoot = await realpath(repo);

      expect(repositoryRoot(nested)).toBe(repoRoot);
      expect(await ensureBridgeDir(nested)).toBe(join(repoRoot, ".bridge"));
      await expect(access(join(nested, ".bridge"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it("keeps an explicit non-Git directory as its own root", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bridge-non-git-"));
    try {
      expect(repositoryRoot(directory)).toBe(directory);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("creates no internal .gitignore", async () => {
    const repo = await mkdtemp(join(tmpdir(), "bridge-no-ignore-"));
    try {
      await ensureBridgeDir(repo);
      await expect(access(join(bridgeDir(repo), ".gitignore"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});
