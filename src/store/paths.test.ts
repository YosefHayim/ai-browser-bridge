import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ensureBridgeDirectory,
  readBridgeDirectory,
  readDownloadsDirectory,
  readLogsDirectory,
  readRepositoryPath,
  readRepositoryRoot,
  readSessionsDirectory,
  readSettingsPath,
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
    expect(readBridgeDirectory(repo)).toBe("/tmp/example-repo/.bridge");
    expect(readSettingsPath(repo)).toBe("/tmp/example-repo/.bridge/config.json");
    expect(readLogsDirectory(repo)).toBe("/tmp/example-repo/.bridge/logs");
    expect(readSessionsDirectory(repo)).toBe("/tmp/example-repo/.bridge/sessions");
    expect(readDownloadsDirectory(repo)).toBe("/tmp/example-repo/.bridge/downloads");
  });

  it("resolves a nested launch directory to its Git working-tree root", async () => {
    const repo = await mkdtemp(join(tmpdir(), "bridge-root-"));
    const nested = join(repo, "packages", "app", "src");
    try {
      execFileSync("git", ["init", "-q"], { cwd: repo });
      await mkdir(nested, { recursive: true });
      const repoRoot = await realpath(repo);

      expect(readRepositoryRoot(nested)).toBe(repoRoot);
      expect(await ensureBridgeDirectory(nested)).toBe(join(repoRoot, ".bridge"));
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
      await ensureBridgeDirectory(repo);
      await expect(access(join(readBridgeDirectory(repo), ".gitignore"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});
