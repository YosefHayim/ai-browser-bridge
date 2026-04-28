import { describe, expect, it } from "vitest";
import { bridgeLogPath } from "../../src/core/logging.ts";

describe("bridgeLogPath", () => {
  it("uses the local calendar date for log filenames", () => {
    expect(bridgeLogPath(new Date(2026, 0, 2, 0, 30))).toMatch(/2026-01-02\.jsonl$/);
  });
});
