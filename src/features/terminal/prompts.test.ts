import { describe, expect, it } from "vitest";
import type { CommandContext } from "@/features/domain";
import { projectTaskPrompt, projectTaskPromptWithInstructions } from "./cliOperations.ts";

// The prompt builders read only ctx.config.repoPath; a minimal stub is enough.
const ctx = { config: { repoPath: "/repo" } } as unknown as CommandContext;

describe("projectTaskPrompt", () => {
  it("embeds the repo path and the user task", () => {
    const out = projectTaskPrompt("fix the parser", ctx);
    expect(out).toContain("Repo path: /repo");
    expect(out).toContain("User task:\nfix the parser");
  });

  it("omits the instruction-files block when none are supplied", () => {
    expect(projectTaskPrompt("x", ctx)).not.toContain("Project instruction files:");
  });
});

describe("projectTaskPromptWithInstructions", () => {
  it("appends project instructions when provided", () => {
    const out = projectTaskPromptWithInstructions("x", ctx, "Always run lint");
    expect(out).toContain("Project instruction files:");
    expect(out).toContain("Always run lint");
  });

  it("treats whitespace-only instructions as empty", () => {
    expect(projectTaskPromptWithInstructions("x", ctx, "   \n  ")).not.toContain(
      "Project instruction files:",
    );
  });
});
