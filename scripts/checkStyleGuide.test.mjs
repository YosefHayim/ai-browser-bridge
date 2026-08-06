import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkStyleGuide } from "./checkStyleGuide.mjs";

const REPOSITORY_ROOT = join(import.meta.dirname, "..");

const readRepositoryGuide = async () => {
  const guideText = await readFile(join(REPOSITORY_ROOT, "CODE-STYLE.md"), "utf8");
  const mirrorText = await readFile(join(REPOSITORY_ROOT, "code-style.rules.json"), "utf8");
  return { guideText, declaredRules: JSON.parse(mirrorText).rules };
};

describe("CODE-STYLE.md", () => {
  it("matches its machine mirror", async () => {
    const repositoryGuide = await readRepositoryGuide();
    expect(checkStyleGuide(repositoryGuide)).toEqual([]);
  });

  it("rejects a planted assertion drift", async () => {
    const repositoryGuide = await readRepositoryGuide();
    const changedGuide = repositoryGuide.guideText.replace(
      "Every project-owned identifier names its concrete domain value or action without generic names or avoidable abbreviations.",
      "Every project-owned identifier uses a short name.",
    );
    const violations = checkStyleGuide({
      guideText: changedGuide,
      declaredRules: repositoryGuide.declaredRules,
    });
    expect(violations.some((violation) => violation.ruleId === "naming.domain")).toBe(true);
  });
});
