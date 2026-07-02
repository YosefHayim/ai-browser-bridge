import { describe, expect, it } from "vitest";
import type { CommandContext } from "../../../src/features/domain/types.ts";
import {
  buildProjectTaskPrompt,
  buildProjectTaskPromptWithInstructions,
} from "../../../src/features/terminal/cliRunner.ts";

// The prompt builders read only ctx.config.repoPath; a minimal stub is enough.
const ctx = { config: { repoPath: "/repo" } } as unknown as CommandContext;

describe("buildProjectTaskPrompt", () => {
  it("embeds the repo path and the user task", () => {
    const out = buildProjectTaskPrompt("fix the parser", ctx);
    expect(out).toContain("Repo path: /repo");
    expect(out).toContain("User task:\nfix the parser");
  });

  it("omits the instruction-files block when none are supplied", () => {
    expect(buildProjectTaskPrompt("x", ctx)).not.toContain("Project instruction files:");
  });
});

describe("buildProjectTaskPromptWithInstructions", () => {
  it("appends project instructions when provided", () => {
    const out = buildProjectTaskPromptWithInstructions("x", ctx, "Always run lint");
    expect(out).toContain("Project instruction files:");
    expect(out).toContain("Always run lint");
  });

  it("treats whitespace-only instructions as empty", () => {
    expect(buildProjectTaskPromptWithInstructions("x", ctx, "   \n  ")).not.toContain(
      "Project instruction files:",
    );
  });
});
