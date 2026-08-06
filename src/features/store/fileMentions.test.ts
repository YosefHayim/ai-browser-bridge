import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { expandFileMentions, extractFileMentions } from "./fileMentions.ts";

describe("expandFileMentions", () => {
  it("extracts unique @file mentions", () => {
    expect(
      extractFileMentions("read @README.md and @src/terminal/tui/App.tsx and @README.md"),
    ).toEqual(["README.md", "src/terminal/tui/App.tsx"]);
  });

  it("returns prompt unchanged when no @file mentions", async () => {
    const result = await expandFileMentions("hello world", "/tmp");
    expect(result.prompt).toBe("hello world");
    expect(result.files).toHaveLength(0);
  });

  it("resolves @file mentions to file contents", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bridge-test-"));
    await writeFile(join(dir, "hello.txt"), "file contents here");

    const result = await expandFileMentions("read @hello.txt", dir);
    expect(result.prompt).toContain("file contents here");
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.relativePath).toBe("hello.txt");
  });

  it("skips paths that escape the repo root", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bridge-test-"));
    const result = await expandFileMentions("read @../../etc/passwd", dir);
    expect(result.files).toHaveLength(0);
  });

  it("reports file not found for missing files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bridge-test-"));
    const result = await expandFileMentions("read @missing.txt", dir);
    expect(result.prompt).toContain("file not found");
  });
});
