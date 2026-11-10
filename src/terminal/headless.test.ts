import { describe, expect, it } from "vitest";
import { convertSecondsToTimeoutMilliseconds } from "./cli-option-readers.ts";

describe("timeoutMsFromSeconds", () => {
  it("returns undefined for absent, empty, or non-positive input", () => {
    expect(convertSecondsToTimeoutMilliseconds(undefined)).toBeUndefined();
    expect(convertSecondsToTimeoutMilliseconds("")).toBeUndefined();
    expect(convertSecondsToTimeoutMilliseconds("0")).toBeUndefined();
    expect(convertSecondsToTimeoutMilliseconds("-5")).toBeUndefined();
    expect(convertSecondsToTimeoutMilliseconds("abc")).toBeUndefined();
  });

  it("converts a positive seconds string to milliseconds", () => {
    expect(convertSecondsToTimeoutMilliseconds("300")).toBe(300_000);
    expect(convertSecondsToTimeoutMilliseconds("30")).toBe(30_000);
    expect(convertSecondsToTimeoutMilliseconds("1.5")).toBe(1_500);
  });
});
