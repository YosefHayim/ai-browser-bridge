import { describe, expect, it } from "vitest";
import type { CommandSession } from "@/domain/command-types.ts";
import {
  createProjectTaskPrompt,
  createProjectTaskPromptWithInstructions,
} from "./project-task-prompt.ts";

// The prompt builders read only ctx.config.repoPath; a minimal stub is enough.
const commandScope = { config: { repoPath: "/repo" } } as unknown as CommandSession;

describe("projectTaskPrompt", () => {
  it("embeds the repo path and the user task", () => {
    const out = createProjectTaskPrompt("fix the parser", commandScope);
    expect(out).toContain("Repo path: /repo");
    expect(out).toContain("User task:\nfix the parser");
  });

  it("omits the instruction-files block when none are supplied", () => {
    expect(createProjectTaskPrompt("x", commandScope)).not.toContain("Project instruction files:");
  });
});

describe("projectTaskPromptWithInstructions", () => {
  it("appends project instructions when provided", () => {
    const out = createProjectTaskPromptWithInstructions("x", commandScope, "Always run lint");
    expect(out).toContain("Project instruction files:");
    expect(out).toContain("Always run lint");
  });

  it("treats whitespace-only instructions as empty", () => {
    expect(createProjectTaskPromptWithInstructions("x", commandScope, "   \n  ")).not.toContain(
      "Project instruction files:",
    );
  });
});
