import { describe, expect, it } from "vitest";
import { readTimeoutMsFromSeconds } from "./cli-operations.ts";

describe("timeoutMsFromSeconds", () => {
  it("returns undefined for absent, empty, or non-positive input", () => {
    expect(readTimeoutMsFromSeconds(undefined)).toBeUndefined();
    expect(readTimeoutMsFromSeconds("")).toBeUndefined();
    expect(readTimeoutMsFromSeconds("0")).toBeUndefined();
    expect(readTimeoutMsFromSeconds("-5")).toBeUndefined();
    expect(readTimeoutMsFromSeconds("abc")).toBeUndefined();
  });

  it("converts a positive seconds string to milliseconds", () => {
    expect(readTimeoutMsFromSeconds("300")).toBe(300_000);
    expect(readTimeoutMsFromSeconds("30")).toBe(30_000);
    expect(readTimeoutMsFromSeconds("1.5")).toBe(1_500);
  });
});
