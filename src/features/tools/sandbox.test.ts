import { describe, expect, it } from "vitest";
import { isAllowedTestCommand } from "./mcpServer.ts";

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
