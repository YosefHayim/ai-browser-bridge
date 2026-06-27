import { describe, expect, it } from "vitest";
import { timeoutMsFromSeconds } from "../../src/cli/headless.ts";

describe("timeoutMsFromSeconds", () => {
  it("returns undefined for absent, empty, or non-positive input", () => {
    expect(timeoutMsFromSeconds(undefined)).toBeUndefined();
    expect(timeoutMsFromSeconds("")).toBeUndefined();
    expect(timeoutMsFromSeconds("0")).toBeUndefined();
    expect(timeoutMsFromSeconds("-5")).toBeUndefined();
    expect(timeoutMsFromSeconds("abc")).toBeUndefined();
  });

  it("converts a positive seconds string to milliseconds", () => {
    expect(timeoutMsFromSeconds("300")).toBe(300_000);
    expect(timeoutMsFromSeconds("30")).toBe(30_000);
    expect(timeoutMsFromSeconds("1.5")).toBe(1_500);
  });
});
