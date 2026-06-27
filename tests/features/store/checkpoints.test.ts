import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createCheckpoint,
  listCheckpoints,
  restoreCheckpoint,
} from "../../../src/features/store/checkpoints.ts";

async function makeTempRepo(): Promise<{ repoRoot: string; checkpointRoot: string }> {
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
    const { repoRoot, checkpointRoot } = await makeTempRepo();
    await writeFile(join(repoRoot, "src.txt"), "before", { flag: "w" });

    const checkpoint = await createCheckpoint({
      repoRoot,
      checkpointRoot,
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
    expect(checkpoint.files[0].sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects paths outside the repo", async () => {
    const { repoRoot, checkpointRoot } = await makeTempRepo();

    await expect(
      createCheckpoint({
        repoRoot,
        checkpointRoot,
        paths: ["../outside.txt"],
      }),
    ).rejects.toThrow("Path escapes repo root");
  });

  it("rejects directories", async () => {
    const { repoRoot, checkpointRoot } = await makeTempRepo();
    await writeFile(join(repoRoot, "file.txt"), "content", { flag: "w" });

    await expect(
      createCheckpoint({
        repoRoot,
        checkpointRoot,
        paths: ["."],
      }),
    ).rejects.toThrow("Cannot checkpoint directory");
  });
});

describe("listCheckpoints and restoreCheckpoint", () => {
  it("lists snapshots and restores file contents", async () => {
    const { repoRoot, checkpointRoot } = await makeTempRepo();
    await writeFile(join(repoRoot, "src.txt"), "before", { flag: "w" });

    const checkpoint = await createCheckpoint({
      repoRoot,
      checkpointRoot,
      paths: ["src.txt", "new.txt"],
      label: "restore-me",
      now: new Date("2026-04-28T12:00:00.000Z"),
    });

    await writeFile(join(repoRoot, "src.txt"), "after", { flag: "w" });
    await writeFile(join(repoRoot, "new.txt"), "created", { flag: "w" });

    const listed = await listCheckpoints({ repoRoot, checkpointRoot });
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      id: checkpoint.id,
      label: "restore-me",
      fileCount: 2,
    });

    const restored = await restoreCheckpoint({
      repoRoot,
      checkpointRoot,
      checkpointId: checkpoint.id,
    });

    expect(restored.restored).toEqual(["src.txt"]);
    expect(restored.removed).toEqual(["new.txt"]);
    await expect(readFile(join(repoRoot, "src.txt"), "utf-8")).resolves.toBe("before");
    await expect(readFile(join(repoRoot, "new.txt"), "utf-8")).rejects.toThrow();
  });

  it("can restore only selected paths from a checkpoint", async () => {
    const { repoRoot, checkpointRoot } = await makeTempRepo();
    await writeFile(join(repoRoot, "a.txt"), "A1", { flag: "w" });
    await writeFile(join(repoRoot, "b.txt"), "B1", { flag: "w" });

    const checkpoint = await createCheckpoint({
      repoRoot,
      checkpointRoot,
      paths: ["a.txt", "b.txt"],
    });

    await writeFile(join(repoRoot, "a.txt"), "A2", { flag: "w" });
    await writeFile(join(repoRoot, "b.txt"), "B2", { flag: "w" });

    await restoreCheckpoint({
      repoRoot,
      checkpointRoot,
      checkpointId: checkpoint.id,
      paths: ["b.txt"],
    });

    await expect(readFile(join(repoRoot, "a.txt"), "utf-8")).resolves.toBe("A2");
    await expect(readFile(join(repoRoot, "b.txt"), "utf-8")).resolves.toBe("B1");
  });

  it("rejects restore paths outside the repo", async () => {
    const { repoRoot, checkpointRoot } = await makeTempRepo();
    await writeFile(join(repoRoot, "safe.txt"), "safe", { flag: "w" });
    const checkpoint = await createCheckpoint({ repoRoot, checkpointRoot, paths: ["safe.txt"] });

    await expect(
      restoreCheckpoint({
        repoRoot,
        checkpointRoot,
        checkpointId: checkpoint.id,
        paths: ["../outside.txt"],
      }),
    ).rejects.toThrow("Path escapes repo root");
  });

  it("returns an empty list when no checkpoint store exists", async () => {
    const base = await mkdtemp(join(tmpdir(), "bridge-checkpoints-empty-"));
    const checkpoints = await listCheckpoints({
      repoRoot: join(base, "repo"),
      checkpointRoot: join(base, "missing-store"),
    });
    expect(checkpoints).toEqual([]);
    await rm(base, { recursive: true, force: true });
  });
});
