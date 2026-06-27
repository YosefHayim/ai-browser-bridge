import { describe, expect, it } from "vitest";
import {
  evaluateToolPermission,
  normalizePermissionMode,
  permissionDecisionToToolResult,
  toolPermissionKind,
} from "../../../src/features/domain/permissions.ts";

describe("normalizePermissionMode", () => {
  it("defaults invalid values to read-only", () => {
    expect(normalizePermissionMode(undefined)).toBe("read-only");
    expect(normalizePermissionMode("unsafe")).toBe("read-only");
  });

  it("accepts supported permission modes", () => {
    expect(normalizePermissionMode("ask")).toBe("ask");
    expect(normalizePermissionMode("auto")).toBe("auto");
  });
});

describe("toolPermissionKind", () => {
  it("classifies known read tools", () => {
    expect(toolPermissionKind("read_file")).toBe("read");
    expect(toolPermissionKind("grep_code")).toBe("read");
    expect(toolPermissionKind("git_diff")).toBe("read");
  });

  it("classifies known write and test tools", () => {
    expect(toolPermissionKind("apply_patch")).toBe("write");
    expect(toolPermissionKind("run_tests")).toBe("test");
  });

  it("treats unknown tools as process-level access", () => {
    expect(toolPermissionKind("spawn_process")).toBe("process");
  });
});

describe("evaluateToolPermission", () => {
  it("allows read tools in read-only mode", () => {
    expect(evaluateToolPermission("read_file", "read-only")).toMatchObject({
      allowed: true,
      status: "allowed",
      kind: "read",
    });
  });

  it("blocks write, test, and process tools in read-only mode", () => {
    for (const toolName of ["apply_patch", "run_tests", "spawn_process"]) {
      expect(evaluateToolPermission(toolName, "read-only")).toMatchObject({
        allowed: false,
        status: "blocked",
      });
    }
  });

  it("returns needs-confirmation for non-read tools in ask mode", () => {
    expect(evaluateToolPermission("apply_patch", "ask")).toMatchObject({
      allowed: false,
      status: "needs-confirmation",
      reason: "interactive-confirmation-unavailable",
    });
  });

  it("allows all known access kinds in auto mode", () => {
    for (const toolName of ["read_file", "apply_patch", "run_tests", "spawn_process"]) {
      expect(evaluateToolPermission(toolName, "auto")).toMatchObject({
        allowed: true,
        status: "allowed",
      });
    }
  });
});

describe("permissionDecisionToToolResult", () => {
  it("returns no tool result when a decision is allowed", () => {
    expect(permissionDecisionToToolResult(evaluateToolPermission("read_file", "read-only"))).toBe(
      undefined,
    );
  });

  it("formats blocked decisions as clear MCP tool results", () => {
    const result = permissionDecisionToToolResult(evaluateToolPermission("run_tests", "ask"));
    expect(result).toEqual({
      ok: false,
      error: "interactive-confirmation-unavailable",
      output:
        "Tool run_tests requires test access, but permission mode ask cannot continue because interactive confirmation is not implemented yet.",
    });
  });
});
