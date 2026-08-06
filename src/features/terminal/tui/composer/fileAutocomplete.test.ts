import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyFileCompletion,
  completeFileMention,
  findActiveFileMention,
} from "./fileAutocomplete.ts";

const seedCompletionRepo = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "bridge-file-complete-"));
  await mkdir(join(dir, ".bridge"), { recursive: true });
  await mkdir(join(dir, ".git"), { recursive: true });
  await mkdir(join(dir, "src", "features", "terminal"), { recursive: true });
  await mkdir(join(dir, "src", "features", "bridge"), { recursive: true });
  await writeFile(join(dir, "README.md"), "readme");
  await writeFile(join(dir, "src", "features", "terminal", "App.tsx"), "app");
  await writeFile(join(dir, "src", "features", "bridge", "loadConfig.ts"), "config");
  return dir;
};

describe("findActiveFileMention", () => {
  it("returns the active @file token before the cursor", () => {
    expect(findActiveFileMention({ input: "read @src/cl", cursor: 12 })).toEqual({
      start: 5,
      end: 12,
      partial: "src/cl",
    });
  });

  it("ignores email-like and whitespace-terminated @ tokens", () => {
    expect(findActiveFileMention({ input: "mail a@b.com", cursor: 12 })).toBeUndefined();
    expect(findActiveFileMention({ input: "read @src then", cursor: 14 })).toBeUndefined();
  });
});

describe("completeFileMention", () => {
  it("returns repo-relative path completions for active @file input", async () => {
    const repoRoot = await seedCompletionRepo();

    const completion = await completeFileMention("read @src/features/t", repoRoot, { limit: 5 });

    expect(completion?.replacement).toBe("src/features/terminal/");
    expect(completion?.matches.map((match) => match.path)).toEqual(["src/features/terminal/"]);
  });

  it("continues completion inside a directory after a trailing slash", async () => {
    const repoRoot = await seedCompletionRepo();

    const completion = await completeFileMention("read @src/features/", repoRoot, { limit: 5 });

    expect(completion?.matches.map((match) => match.path)).toEqual([
      "src/features/bridge/",
      "src/features/terminal/",
    ]);
  });

  it("keeps hidden folders out of default @ suggestions unless the user types dot", async () => {
    const repoRoot = await seedCompletionRepo();

    const defaultCompletion = await completeFileMention("read @", repoRoot, { limit: 20 });
    const dotCompletion = await completeFileMention("read @.", repoRoot, { limit: 20 });

    expect(defaultCompletion?.matches.map((match) => match.path)).not.toContain(".bridge/");
    expect(defaultCompletion?.matches.map((match) => match.path)).not.toContain(".git/");
    expect(dotCompletion?.matches.map((match) => match.path)).toContain(".bridge/");
    expect(dotCompletion?.matches.map((match) => match.path)).not.toContain(".git/");
  });

  it("does not autocomplete paths that escape the repo root", async () => {
    const repoRoot = await seedCompletionRepo();

    await expect(completeFileMention("read @../", repoRoot)).resolves.toBeUndefined();
  });
});

describe("applyFileCompletion", () => {
  it("replaces only the active mention token", () => {
    expect(
      applyFileCompletion("read @src/features/t please", {
        start: 5,
        end: 20,
        replacement: "src/features/terminal/",
      }),
    ).toBe("read @src/features/terminal/ please");
  });
});
