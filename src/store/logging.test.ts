import { describe, expect, it } from "vitest";
import { bridgeLogPath } from "./logging.ts";

describe("bridgeLogPath", () => {
  it("uses the local calendar date for log filenames", () => {
    expect(bridgeLogPath("/repo", new Date(2026, 0, 2, 0, 30))).toMatch(/2026-01-02\.jsonl$/);
  });

  it("places logs under the repo's .bridge/logs", () => {
    expect(bridgeLogPath("/repo", new Date(2026, 0, 2))).toBe(
      "/repo/.bridge/logs/2026-01-02.jsonl",
    );
  });
});
