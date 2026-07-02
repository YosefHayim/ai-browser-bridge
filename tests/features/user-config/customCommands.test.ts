import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type CustomCommand,
  loadCustomCommands,
  parseCustomCommandFile,
  renderCustomCommandPrompt,
} from "../../../src/features/user-config/hooks.ts";

async function tempDir(): Promise<string> {
  const { mkdtemp } = await import("node:fs/promises");
  return mkdtemp(join(tmpdir(), "bridge-commands-test-"));
}

describe("custom commands", () => {
  it("loads markdown commands from project and user command dirs", async () => {
    const repoRoot = await tempDir();
    const homeDir = await tempDir();
    await mkdir(join(repoRoot, ".bridge", "commands"), { recursive: true });
    await mkdir(join(homeDir, ".ai-browser-bridge", "commands"), { recursive: true });
    await writeFile(join(repoRoot, ".bridge", "commands", "review.md"), "Review $ARGUMENTS");
    await writeFile(join(homeDir, ".ai-browser-bridge", "commands", "commit.md"), "Commit $1");

    const commands = await loadCustomCommands({ repoRoot, homeDir });

    expect(commands.map((command) => `${command.source}:${command.name}`)).toEqual([
      "user:commit",
      "project:review",
    ]);
    expect(commands.find((command) => command.name === "review")?.promptTemplate).toBe(
      "Review $ARGUMENTS",
    );
  });

  it("parses dependency-free YAML-like frontmatter", () => {
    const parsed = parseCustomCommandFile(`---
description: "Run a focused review"
model: GPT-5.2
allowedTools:
  - grep_code
  - read_file
---
Review the diff.`);

    expect(parsed.metadata).toEqual({
      description: "Run a focused review",
      model: "GPT-5.2",
      allowedTools: ["grep_code", "read_file"],
    });
    expect(parsed.body).toBe("Review the diff.");
  });

  it("parses inline allowedTools lists", () => {
    const parsed = parseCustomCommandFile(`---
allowedTools: [grep_code, read_file]
---
Use tools.`);

    expect(parsed.metadata.allowedTools).toEqual(["grep_code", "read_file"]);
  });

  it("expands arguments and positional placeholders", () => {
    const command: CustomCommand = {
      name: "fix",
      filePath: "/tmp/fix.md",
      source: "project",
      allowedTools: [],
      promptTemplate: "Fix $1 in $2. Full: $ARGUMENTS. Missing: $3",
    };

    expect(renderCustomCommandPrompt(command, 'login "src/app.ts"')).toBe(
      'Fix login in src/app.ts. Full: login "src/app.ts". Missing: ',
    );
  });

  it("returns an empty list when command dirs do not exist", async () => {
    const repoRoot = await tempDir();
    const homeDir = await tempDir();

    await expect(loadCustomCommands({ repoRoot, homeDir })).resolves.toEqual([]);
  });
});
