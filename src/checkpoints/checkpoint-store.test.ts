import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CheckpointStore } from "@/checkpoints/checkpoint-store.ts";

async function makeScratchRepo(): Promise<{ repoRoot: string; checkpointRoot: string }> {
  const base = await mkdtemp(join(tmpdir(), "bridge-checkpoints-"));
  const repoRoot = join(base, "repo");
  await mkdir(repoRoot, { recursive: true });
  return {
    repoRoot,
    checkpointRoot: join(base, "store"),
  };
}

describe("createCheckpoint", () => {
  it("snapshots existing and missing files inside the repo", async () => {
    const { repoRoot, checkpointRoot } = await makeScratchRepo();
    await writeFile(join(repoRoot, "src.txt"), "before", { flag: "w" });

    const checkpoint = await new CheckpointStore(repoRoot, checkpointRoot).create({
      paths: ["src.txt", "missing.txt"],
      phase: "before",
      label: "patch",
      now: new Date("2026-04-28T12:00:00.000Z"),
    });

    expect(checkpoint.phase).toBe("before");
    expect(checkpoint.files).toMatchObject([
      { relativePath: "src.txt", exists: true, size: 6 },
      { relativePath: "missing.txt", exists: false, size: 0 },
    ]);
    expect(checkpoint.files[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects paths outside the repo", async () => {
    const { repoRoot, checkpointRoot } = await makeScratchRepo();

    await expect(
      new CheckpointStore(repoRoot, checkpointRoot).create({ paths: ["../outside.txt"] }),
    ).rejects.toThrow("Path escapes repo root");
  });

  it("rejects directories", async () => {
    const { repoRoot, checkpointRoot } = await makeScratchRepo();
    await writeFile(join(repoRoot, "file.txt"), "content", { flag: "w" });

    await expect(
      new CheckpointStore(repoRoot, checkpointRoot).create({ paths: ["."] }),
    ).rejects.toThrow("Cannot checkpoint directory");
  });
});

describe("listCheckpoints and restoreCheckpoint", () => {
  it("lists snapshots and restores file contents", async () => {
    const { repoRoot, checkpointRoot } = await makeScratchRepo();
    await writeFile(join(repoRoot, "src.txt"), "before", { flag: "w" });

    const checkpoint = await new CheckpointStore(repoRoot, checkpointRoot).create({
      paths: ["src.txt", "new.txt"],
      label: "restore-me",
      now: new Date("2026-04-28T12:00:00.000Z"),
    });

    await writeFile(join(repoRoot, "src.txt"), "after", { flag: "w" });
    await writeFile(join(repoRoot, "new.txt"), "created", { flag: "w" });

    const listed = await new CheckpointStore(repoRoot, checkpointRoot).list();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      id: checkpoint.id,
      label: "restore-me",
      fileCount: 2,
    });

    const restored = await new CheckpointStore(repoRoot, checkpointRoot).restore({
      checkpointId: checkpoint.id,
    });

    expect(restored.restored).toEqual(["src.txt"]);
    expect(restored.removed).toEqual(["new.txt"]);
    await expect(readFile(join(repoRoot, "src.txt"), "utf-8")).resolves.toBe("before");
    await expect(readFile(join(repoRoot, "new.txt"), "utf-8")).rejects.toThrow();
  });

  it("can restore only selected paths from a checkpoint", async () => {
    const { repoRoot, checkpointRoot } = await makeScratchRepo();
    await writeFile(join(repoRoot, "a.txt"), "A1", { flag: "w" });
    await writeFile(join(repoRoot, "b.txt"), "B1", { flag: "w" });

    const checkpoint = await new CheckpointStore(repoRoot, checkpointRoot).create({
      paths: ["a.txt", "b.txt"],
    });

    await writeFile(join(repoRoot, "a.txt"), "A2", { flag: "w" });
    await writeFile(join(repoRoot, "b.txt"), "B2", { flag: "w" });

    await new CheckpointStore(repoRoot, checkpointRoot).restore({
      checkpointId: checkpoint.id,
      paths: ["b.txt"],
    });

    await expect(readFile(join(repoRoot, "a.txt"), "utf-8")).resolves.toBe("A2");
    await expect(readFile(join(repoRoot, "b.txt"), "utf-8")).resolves.toBe("B1");
  });

  it("rejects restore paths outside the repo", async () => {
    const { repoRoot, checkpointRoot } = await makeScratchRepo();
    await writeFile(join(repoRoot, "safe.txt"), "safe", { flag: "w" });
    const checkpoint = await new CheckpointStore(repoRoot, checkpointRoot).create({
      paths: ["safe.txt"],
    });

    await expect(
      new CheckpointStore(repoRoot, checkpointRoot).restore({
        checkpointId: checkpoint.id,
        paths: ["../outside.txt"],
      }),
    ).rejects.toThrow("Path escapes repo root");
  });

  it("returns an empty list when no checkpoint store exists", async () => {
    const base = await mkdtemp(join(tmpdir(), "bridge-checkpoints-empty-"));
    const checkpoints = await new CheckpointStore(
      join(base, "repo"),
      join(base, "missing-store"),
    ).list();
    expect(checkpoints).toEqual([]);
    await rm(base, { recursive: true, force: true });
  });
});
