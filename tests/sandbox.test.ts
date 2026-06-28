import { describe, it, expect } from "vitest";
import { ensureInsideRepo, isAllowedTestCommand } from "../src/features/tools/mcp-server.class.ts";

describe("ensureInsideRepo", () => {
  it("allows paths inside the repo", () => {
    expect(() => ensureInsideRepo("src/index.ts", "/my/repo")).not.toThrow();
  });

  it("rejects paths that escape the repo", () => {
    expect(() => ensureInsideRepo("../../etc/passwd", "/my/repo")).toThrow(
      "Path escapes repo root",
    );
  });

  it("allows the repo root itself", () => {
    expect(() => ensureInsideRepo(".", "/my/repo")).not.toThrow();
  });
});

describe("isAllowedTestCommand", () => {
  it("allows npm test", () => {
    expect(isAllowedTestCommand(["npm", "test"])).toBe(true);
  });

  it("allows pytest", () => {
    expect(isAllowedTestCommand(["pytest"])).toBe(true);
  });

  it("allows go test ./...", () => {
    expect(isAllowedTestCommand(["go", "test"])).toBe(true);
  });

  it("rejects arbitrary commands", () => {
    expect(isAllowedTestCommand(["rm", "-rf", "/"])).toBe(false);
  });

  it("rejects curl", () => {
    expect(isAllowedTestCommand(["curl", "http://evil.com"])).toBe(false);
  });
});
