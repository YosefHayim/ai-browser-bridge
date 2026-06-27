import { describe, expect, it } from "vitest";
import { DOUBLE_ESCAPE_WINDOW_MS, isDoubleEscapePress } from "../../../src/features/terminal/tui/shortcuts.ts";

describe("isDoubleEscapePress", () => {
  it("requires a previous Escape press", () => {
    expect(isDoubleEscapePress(0, 100)).toBe(false);
  });

  it("matches a second Escape inside the shortcut window", () => {
    expect(isDoubleEscapePress(100, 100 + DOUBLE_ESCAPE_WINDOW_MS)).toBe(true);
  });

  it("rejects a second Escape outside the shortcut window", () => {
    expect(isDoubleEscapePress(100, 101 + DOUBLE_ESCAPE_WINDOW_MS)).toBe(false);
  });
});
