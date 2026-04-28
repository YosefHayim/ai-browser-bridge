import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyFileCompletion,
  completeFileMention,
  findActiveFileMention,
} from "../../src/cli/file-autocomplete.ts";

async function createRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "bridge-file-complete-"));
  await mkdir(join(dir, ".bridge"), { recursive: true });
  await mkdir(join(dir, ".git"), { recursive: true });
  await mkdir(join(dir, "src", "cli"), { recursive: true });
  await mkdir(join(dir, "src", "core"), { recursive: true });
  await writeFile(join(dir, "README.md"), "readme");
  await writeFile(join(dir, "src", "cli", "app.tsx"), "app");
  await writeFile(join(dir, "src", "core", "config.ts"), "config");
  return dir;
}

describe("findActiveFileMention", () => {
  it("returns the active @file token before the cursor", () => {
    expect(findActiveFileMention("read @src/cl", 12)).toEqual({
      start: 5,
      end: 12,
      partial: "src/cl",
    });
  });

  it("ignores email-like and whitespace-terminated @ tokens", () => {
    expect(findActiveFileMention("mail a@b.com", 12)).toBeNull();
    expect(findActiveFileMention("read @src then", 14)).toBeNull();
  });
});

describe("completeFileMention", () => {
  it("returns repo-relative path completions for active @file input", async () => {
    const repoRoot = await createRepo();

    const result = await completeFileMention("read @src/c", repoRoot, { limit: 5 });

    expect(result?.replacement).toBe("src/cli/");
    expect(result?.matches.map((match) => match.path)).toEqual(["src/cli/", "src/core/"]);
  });

  it("continues completion inside a directory after a trailing slash", async () => {
    const repoRoot = await createRepo();

    const result = await completeFileMention("read @src/", repoRoot, { limit: 5 });

    expect(result?.matches.map((match) => match.path)).toEqual(["src/cli/", "src/core/"]);
  });

  it("keeps hidden folders out of default @ suggestions unless the user types dot", async () => {
    const repoRoot = await createRepo();

    const defaultResult = await completeFileMention("read @", repoRoot, { limit: 20 });
    const dotResult = await completeFileMention("read @.", repoRoot, { limit: 20 });

    expect(defaultResult?.matches.map((match) => match.path)).not.toContain(".bridge/");
    expect(defaultResult?.matches.map((match) => match.path)).not.toContain(".git/");
    expect(dotResult?.matches.map((match) => match.path)).toContain(".bridge/");
    expect(dotResult?.matches.map((match) => match.path)).not.toContain(".git/");
  });

  it("does not autocomplete paths that escape the repo root", async () => {
    const repoRoot = await createRepo();

    await expect(completeFileMention("read @../", repoRoot)).resolves.toBeNull();
  });
});

describe("applyFileCompletion", () => {
  it("replaces only the active mention token", () => {
    expect(applyFileCompletion("read @src/c please", {
      start: 5,
      end: 11,
      partial: "src/c",
      replacement: "src/cli/",
      matches: [],
    })).toBe("read @src/cli/ please");
  });
});
