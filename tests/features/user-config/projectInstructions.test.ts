import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadProjectInstructions,
  renderProjectInstructions,
} from "../../../src/features/user-config/hooks.ts";

async function tempDir(): Promise<string> {
  const { mkdtemp } = await import("node:fs/promises");
  return mkdtemp(join(tmpdir(), "bridge-instructions-test-"));
}

describe("project instructions", () => {
  it("loads AGENTS.md and CLAUDE.md from the repo root with clear headings", async () => {
    const repoRoot = await tempDir();
    await writeFile(join(repoRoot, "AGENTS.md"), "Agent rules");
    await writeFile(join(repoRoot, "CLAUDE.md"), "Claude rules");
    await mkdir(join(repoRoot, "nested"), { recursive: true });
    await writeFile(join(repoRoot, "nested", "AGENTS.md"), "Nested rules");

    const instructions = await loadProjectInstructions(repoRoot);

    expect(instructions.files.map((file) => file.fileName)).toEqual(["AGENTS.md", "CLAUDE.md"]);
    expect(instructions.promptText).toContain("## Project Instructions: AGENTS.md\nAgent rules");
    expect(instructions.promptText).toContain("## Project Instructions: CLAUDE.md\nClaude rules");
    expect(instructions.promptText).not.toContain("Nested rules");
  });

  it("returns empty prompt text when no project instruction files exist", async () => {
    const repoRoot = await tempDir();

    const instructions = await loadProjectInstructions(repoRoot);

    expect(instructions.files).toEqual([]);
    expect(instructions.promptText).toBe("");
  });

  it("renders provided instruction files without reading disk", () => {
    expect(
      renderProjectInstructions([
        { fileName: "AGENTS.md", content: "A" },
        { fileName: "CLAUDE.md", content: "B" },
      ]),
    ).toBe("## Project Instructions: AGENTS.md\nA\n\n## Project Instructions: CLAUDE.md\nB");
  });
});
