import { describe, expect, it } from "vitest";
import type { CommandContext } from "@/domain/command-types.ts";
import { readProjectTaskPrompt, readProjectTaskPromptWithInstructions } from "./cli-operations.ts";

// The prompt builders read only ctx.config.repoPath; a minimal stub is enough.
const ctx = { config: { repoPath: "/repo" } } as unknown as CommandContext;

describe("projectTaskPrompt", () => {
  it("embeds the repo path and the user task", () => {
    const out = readProjectTaskPrompt("fix the parser", ctx);
    expect(out).toContain("Repo path: /repo");
    expect(out).toContain("User task:\nfix the parser");
  });

  it("omits the instruction-files block when none are supplied", () => {
    expect(readProjectTaskPrompt("x", ctx)).not.toContain("Project instruction files:");
  });
});

describe("projectTaskPromptWithInstructions", () => {
  it("appends project instructions when provided", () => {
    const out = readProjectTaskPromptWithInstructions("x", ctx, "Always run lint");
    expect(out).toContain("Project instruction files:");
    expect(out).toContain("Always run lint");
  });

  it("treats whitespace-only instructions as empty", () => {
    expect(readProjectTaskPromptWithInstructions("x", ctx, "   \n  ")).not.toContain(
      "Project instruction files:",
    );
  });
});
