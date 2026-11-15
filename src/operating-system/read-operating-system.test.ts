import { describe, expect, it } from "vitest";
import { readOperatingSystem } from "@/operating-system/read-operating-system.ts";

describe("readOperatingSystem", () => {
  it("maps darwin to macos", () => {
    expect(readOperatingSystem("darwin")).toBe("macos");
  });

  it("maps win32 to windows", () => {
    expect(readOperatingSystem("win32")).toBe("windows");
  });

  it("maps linux to linux", () => {
    expect(readOperatingSystem("linux")).toBe("linux");
  });

  it("throws an error naming an unsupported platform", () => {
    expect(() => readOperatingSystem("freebsd")).toThrow(/freebsd/);
  });

  it("reads the current platform by default", () => {
    expect(["macos", "windows", "linux"]).toContain(readOperatingSystem());
  });
});
