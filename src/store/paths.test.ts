import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ensureBridgeDir,
  readBridgeDir,
  readConfigPath,
  readDownloadsDir,
  readLogsDir,
  readRepositoryPath,
  readRepositoryRoot,
  readSessionsDir,
} from "./paths.ts";

describe("repo-local path resolution", () => {
  it("keeps repository paths inside the repository root", () => {
    expect(readRepositoryPath("/my/repo", "src/index.ts")).toBe("/my/repo/src/index.ts");
    expect(readRepositoryPath("/my/repo", ".")).toBe("/my/repo");
    expect(() => readRepositoryPath("/my/repo", "../../etc/passwd")).toThrow(
      "Path escapes repo root",
    );
  });

  it("scopes every state location under <repo>/.bridge", () => {
    const repo = "/tmp/example-repo";
    expect(readBridgeDir(repo)).toBe("/tmp/example-repo/.bridge");
    expect(readConfigPath(repo)).toBe("/tmp/example-repo/.bridge/config.json");
    expect(readLogsDir(repo)).toBe("/tmp/example-repo/.bridge/logs");
    expect(readSessionsDir(repo)).toBe("/tmp/example-repo/.bridge/sessions");
    expect(readDownloadsDir(repo)).toBe("/tmp/example-repo/.bridge/downloads");
  });

  it("resolves a nested launch directory to its Git working-tree root", async () => {
    const repo = await mkdtemp(join(tmpdir(), "bridge-root-"));
    const nested = join(repo, "packages", "app", "src");
    try {
      execFileSync("git", ["init", "-q"], { cwd: repo });
      await mkdir(nested, { recursive: true });
      const repoRoot = await realpath(repo);

      expect(readRepositoryRoot(nested)).toBe(repoRoot);
      expect(await ensureBridgeDir(nested)).toBe(join(repoRoot, ".bridge"));
      await expect(access(join(nested, ".bridge"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it("keeps an explicit non-Git directory as its own root", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bridge-non-git-"));
    try {
      expect(readRepositoryRoot(directory)).toBe(directory);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("creates no internal .gitignore", async () => {
    const repo = await mkdtemp(join(tmpdir(), "bridge-no-ignore-"));
    try {
      await ensureBridgeDir(repo);
      await expect(access(join(readBridgeDir(repo), ".gitignore"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});
