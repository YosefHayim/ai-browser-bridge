import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { completeFileMention } from "./file-autocomplete-complete.ts";
import { applyFileCompletion, findActiveFileMention } from "./file-mention-completion.ts";

const seedCompletionRepo = async (): Promise<string> => {
  const repoRoot = await mkdtemp(join(tmpdir(), "bridge-file-complete-"));
  await mkdir(join(repoRoot, ".bridge"), { recursive: true });
  await mkdir(join(repoRoot, ".git"), { recursive: true });
  await mkdir(join(repoRoot, "src", "terminal"), { recursive: true });
  await mkdir(join(repoRoot, "src", "bridge"), { recursive: true });
  await writeFile(join(repoRoot, "README.md"), "readme");
  await writeFile(join(repoRoot, "src", "terminal", "App.tsx"), "app");
  await writeFile(join(repoRoot, "src", "bridge", "loadConfig.ts"), "config");
  return repoRoot;
};

describe("findActiveFileMention", () => {
  it("returns the active @file token before the cursor", () => {
    expect(findActiveFileMention({ promptDraft: "read @src/cl", cursor: 12 })).toEqual({
      start: 5,
      end: 12,
      partial: "src/cl",
    });
  });

  it("ignores email-like and whitespace-terminated @ tokens", () => {
    expect(findActiveFileMention({ promptDraft: "mail a@b.com", cursor: 12 })).toBeNull();
    expect(findActiveFileMention({ promptDraft: "read @src then", cursor: 14 })).toBeNull();
  });
});

describe("completeFileMention", () => {
  it("returns repo-relative path completions for active @file input", async () => {
    const repoRoot = await seedCompletionRepo();

    const completion = await completeFileMention("read @src/t", repoRoot, { limit: 5 });

    expect(completion?.replacement).toBe("src/terminal/");
    expect(completion?.matches.map((hit) => hit.path)).toEqual(["src/terminal/"]);
  });

  it("continues completion inside a directory after a trailing slash", async () => {
    const repoRoot = await seedCompletionRepo();

    const completion = await completeFileMention("read @src/", repoRoot, { limit: 5 });

    expect(completion?.matches.map((hit) => hit.path)).toEqual(["src/bridge/", "src/terminal/"]);
  });

  it("keeps hidden folders out of default @ suggestions unless the user types dot", async () => {
    const repoRoot = await seedCompletionRepo();

    const defaultCompletion = await completeFileMention("read @", repoRoot, { limit: 20 });
    const dotCompletion = await completeFileMention("read @.", repoRoot, { limit: 20 });

    expect(defaultCompletion?.matches.map((hit) => hit.path)).not.toContain(".bridge/");
    expect(defaultCompletion?.matches.map((hit) => hit.path)).not.toContain(".git/");
    expect(dotCompletion?.matches.map((hit) => hit.path)).toContain(".bridge/");
    expect(dotCompletion?.matches.map((hit) => hit.path)).not.toContain(".git/");
  });

  it("does not autocomplete paths that escape the repo root", async () => {
    const repoRoot = await seedCompletionRepo();

    await expect(completeFileMention("read @../", repoRoot)).resolves.toBeNull();
  });
});

describe("applyFileCompletion", () => {
  it("replaces only the active mention token", () => {
    expect(
      applyFileCompletion("read @src/t please", {
        start: 5,
        end: 11,
        replacement: "src/terminal/",
      }),
    ).toBe("read @src/terminal/ please");
  });
});
