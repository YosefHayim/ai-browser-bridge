import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getAllCommands } from "../../src/cli/commands/registry.ts";
import {
  applyInputSuggestion,
  commandSuggestionCoverage,
  loadInputSuggestions,
} from "../../src/cli/input-suggestions.ts";
import { createSession } from "../../src/core/session-store.ts";
import { createCheckpoint } from "../../src/core/checkpoints.ts";

async function createRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "bridge-suggestions-repo-"));
  await mkdir(join(dir, "src", "cli"), { recursive: true });
  await mkdir(join(dir, "assets"), { recursive: true });
  await mkdir(join(dir, ".bridge", "commands"), { recursive: true });
  await writeFile(join(dir, "README.md"), "readme");
  await writeFile(join(dir, "src", "cli", "app.tsx"), "app");
  await writeFile(join(dir, "assets", "screen.png"), "png");
  await writeFile(join(dir, "assets", "notes.txt"), "notes");
  return dir;
}

describe("loadInputSuggestions", () => {
  it("shows live file and folder candidates when an @ mention is active", async () => {
    const repoRoot = await createRepo();

    const group = await loadInputSuggestions("inspect @src/c", {
      repoRoot,
      commands: getAllCommands(),
    });

    expect(group?.title).toBe("Files and folders");
    expect(group?.suggestions.map((suggestion) => suggestion.label)).toEqual(["@src/cli/"]);
    expect(group ? applyInputSuggestion("inspect @src/c", group) : "").toBe("inspect @src/cli/");
  });

  it("shows permission modes for /permissions", async () => {
    const repoRoot = await createRepo();

    const group = await loadInputSuggestions("/permissions r", {
      repoRoot,
      commands: getAllCommands(),
    });

    expect(group?.title).toBe("Permissions");
    expect(group?.suggestions.map((suggestion) => suggestion.value)).toEqual(["read-only"]);
    expect(group ? applyInputSuggestion("/permissions r", group) : "").toBe("/permissions read-only");
  });

  it("shows custom command names in the slash command menu", async () => {
    const repoRoot = await createRepo();
    await writeFile(
      join(repoRoot, ".bridge", "commands", "audit.md"),
      [
        "---",
        "description: Inspect the current project",
        "---",
        "Audit $ARGUMENTS",
      ].join("\n"),
    );

    const group = await loadInputSuggestions("/a", {
      repoRoot,
      commands: getAllCommands(),
      customCommandsHomeDir: join(repoRoot, "empty-home"),
    });

    expect(group?.suggestions.map((suggestion) => suggestion.label)).toEqual(["/attach-image", "/audit"]);
    expect(group ? applyInputSuggestion("/a", group, 1) : "").toBe("/audit ");
  });

  it("shows local sessions for session-backed commands", async () => {
    const repoRoot = await createRepo();
    const sessionBase = await mkdtemp(join(tmpdir(), "bridge-suggestions-sessions-"));
    await createSession({
      id: "session-a",
      repoPath: repoRoot,
      model: "GPT-5.2",
      contextLimit: 128_000,
      startedAt: "2026-04-28T10:00:00.000Z",
    }, { baseDir: sessionBase });

    const group = await loadInputSuggestions("/resume ", {
      repoRoot,
      commands: getAllCommands(),
      sessionOptions: { baseDir: sessionBase },
    });

    expect(group?.suggestions.map((suggestion) => suggestion.value)).toContain("--last");
    expect(group?.suggestions.map((suggestion) => suggestion.value)).toContain("session-a");
  });

  it("shows checkpoints for restore and rewind checkpoint arguments", async () => {
    const repoRoot = await createRepo();
    const checkpointRoot = await mkdtemp(join(tmpdir(), "bridge-suggestions-checkpoints-"));
    const checkpoint = await createCheckpoint({
      repoRoot,
      checkpointRoot,
      paths: ["README.md"],
      now: new Date("2026-04-28T12:00:00.000Z"),
    });

    const restore = await loadInputSuggestions("/restore ", {
      repoRoot,
      commands: getAllCommands(),
      checkpointRoot,
    });
    const rewind = await loadInputSuggestions("/rewind --files ", {
      repoRoot,
      commands: getAllCommands(),
      checkpointRoot,
    });

    expect(restore?.suggestions.map((suggestion) => suggestion.value)).toEqual([checkpoint.id]);
    expect(rewind?.suggestions.map((suggestion) => suggestion.value)).toEqual([checkpoint.id]);
  });

  it("moves to path/output arguments after a selected restore or export target", async () => {
    const repoRoot = await createRepo();
    const sessionBase = await mkdtemp(join(tmpdir(), "bridge-suggestions-sessions-"));
    await createSession({
      id: "session-a",
      repoPath: repoRoot,
      model: "GPT-5.2",
      contextLimit: 128_000,
      startedAt: "2026-04-28T10:00:00.000Z",
    }, { baseDir: sessionBase });

    const restore = await loadInputSuggestions("/restore checkpoint-a R", {
      repoRoot,
      commands: getAllCommands(),
    });
    const exported = await loadInputSuggestions("/export session-a ", {
      repoRoot,
      commands: getAllCommands(),
      sessionOptions: { baseDir: sessionBase },
    });

    expect(restore?.suggestions.map((suggestion) => suggestion.value)).toEqual(["README.md"]);
    expect(exported?.suggestions).toEqual([]);
    expect(exported?.hint).toContain("output path");
  });

  it("shows image-only files for /attach-image while keeping folders navigable", async () => {
    const repoRoot = await createRepo();

    const group = await loadInputSuggestions("/attach-image assets/s", {
      repoRoot,
      commands: getAllCommands(),
    });

    expect(group?.suggestions.map((suggestion) => suggestion.value)).toEqual(["assets/screen.png"]);
  });

  it("keeps a suggestion rule for every registered built-in command", () => {
    expect(commandSuggestionCoverage(getAllCommands())).toEqual([]);
  });
});
