import { describe, expect, it } from "vitest";
import {
  cleanPermissionMode,
  convertPermissionDecisionToToolReport,
  evaluateToolPermission,
  readToolPermissionKind,
} from "./permissions.ts";

describe("cleanPermissionMode", () => {
  it("defaults invalid values to read-only", () => {
    expect(cleanPermissionMode(undefined)).toBe("read-only");
    expect(cleanPermissionMode("unsafe")).toBe("read-only");
  });

  it("accepts supported permission modes", () => {
    expect(cleanPermissionMode("ask")).toBe("ask");
    expect(cleanPermissionMode("auto")).toBe("auto");
  });
});

describe("toolPermissionKind", () => {
  it("classifies known read tools", () => {
    expect(readToolPermissionKind("read_file")).toBe("read");
    expect(readToolPermissionKind("grep_code")).toBe("read");
    expect(readToolPermissionKind("git_diff")).toBe("read");
  });

  it("classifies known write and test tools", () => {
    expect(readToolPermissionKind("apply_patch")).toBe("write");
    expect(readToolPermissionKind("run_tests")).toBe("test");
  });

  it("treats unknown tools as process-level access", () => {
    expect(readToolPermissionKind("spawn_process")).toBe("process");
  });
});

describe("evaluateToolPermission", () => {
  it("allows read tools in read-only mode", () => {
    expect(evaluateToolPermission("read_file", "read-only")).toMatchObject({
      status: "allowed",
      kind: "read",
    });
  });

  it("blocks write, test, and process tools in read-only mode", () => {
    for (const toolName of ["apply_patch", "run_tests", "spawn_process"]) {
      expect(evaluateToolPermission(toolName, "read-only")).toMatchObject({
        status: "blocked",
      });
    }
  });

  it("returns needs-confirmation for non-read tools in ask mode", () => {
    expect(evaluateToolPermission("apply_patch", "ask")).toMatchObject({
      status: "needs-confirmation",
      reason: "interactive-confirmation-unavailable",
    });
  });

  it("allows all known access kinds in auto mode", () => {
    for (const toolName of ["read_file", "apply_patch", "run_tests", "spawn_process"]) {
      expect(evaluateToolPermission(toolName, "auto")).toMatchObject({
        status: "allowed",
      });
    }
  });
});

describe("permissionDecisionToToolResult", () => {
  it("returns no tool result when a decision is allowed", () => {
    expect(
      convertPermissionDecisionToToolReport(evaluateToolPermission("read_file", "read-only")),
    ).toBe(undefined);
  });

  it("formats blocked decisions as clear MCP tool results", () => {
    const toolReport = convertPermissionDecisionToToolReport(
      evaluateToolPermission("run_tests", "ask"),
    );
    expect(toolReport).toEqual({
      ok: false,
      error: "interactive-confirmation-unavailable",
      output:
        "Tool run_tests requires test access, but permission mode ask cannot continue because interactive confirmation is not implemented yet.",
    });
  });
});
