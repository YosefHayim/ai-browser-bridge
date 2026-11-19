import { describe, expect, it } from "vitest";
import { convertSecondsToTimeoutMilliseconds } from "@/terminal/cli/cli-option-readers.ts";

describe("convertSecondsToTimeoutMilliseconds", () => {
  it("leaves the timeout unset when no seconds were given", () => {
    expect(convertSecondsToTimeoutMilliseconds(undefined)).toBeUndefined();
  });

  it("converts seconds to milliseconds", () => {
    expect(convertSecondsToTimeoutMilliseconds(300)).toBe(300_000);
    expect(convertSecondsToTimeoutMilliseconds(30)).toBe(30_000);
    expect(convertSecondsToTimeoutMilliseconds(1.5)).toBe(1_500);
  });
});
