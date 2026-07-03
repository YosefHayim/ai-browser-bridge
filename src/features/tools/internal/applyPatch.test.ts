import { describe, expect, it } from "vitest";
import { extractPatchPaths } from "./mcpServer.ts";

describe("extractPatchPaths", () => {
  it("extracts changed file paths from unified git patches", () => {
    const patch = [
      "diff --git a/src/old.ts b/src/new.ts",
      "--- a/src/old.ts",
      "+++ b/src/new.ts",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "diff --git a/README.md b/README.md",
      "--- a/README.md",
      "+++ b/README.md",
    ].join("\n");

    expect(extractPatchPaths(patch)).toEqual(["src/old.ts", "src/new.ts", "README.md"]);
  });

  it("ignores dev-null patch markers", () => {
    expect(extractPatchPaths("--- /dev/null\n+++ b/new-file.ts")).toEqual(["new-file.ts"]);
  });
});
