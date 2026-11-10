import { describe, expect, it } from "vitest";
import type { CommandSession } from "@/domain/command-types.ts";
import {
  createProjectTaskPrompt,
  createProjectTaskPromptWithInstructions,
} from "./cli-operations.ts";

// The prompt builders read only session.config.repoPath; a minimal stub is enough.
const session = { config: { repoPath: "/repo" } } as unknown as CommandSession;

describe("projectTaskPrompt", () => {
  it("embeds the repo path and the user task", () => {
    const out = createProjectTaskPrompt("fix the parser", session);
    expect(out).toContain("Repo path: /repo");
    expect(out).toContain("User task:\nfix the parser");
  });

  it("omits the instruction-files block when none are supplied", () => {
    expect(createProjectTaskPrompt("x", session)).not.toContain("Project instruction files:");
  });
});

describe("projectTaskPromptWithInstructions", () => {
  it("appends project instructions when provided", () => {
    const out = createProjectTaskPromptWithInstructions("x", session, "Always run lint");
    expect(out).toContain("Project instruction files:");
    expect(out).toContain("Always run lint");
  });

  it("treats whitespace-only instructions as empty", () => {
    expect(createProjectTaskPromptWithInstructions("x", session, "   \n  ")).not.toContain(
      "Project instruction files:",
    );
  });
});
