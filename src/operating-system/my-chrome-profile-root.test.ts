import { describe, expect, it } from "vitest";
import { readMyChromeProfileRootOnSystem } from "@/operating-system/my-chrome-profile-root.ts";

describe("readMyChromeProfileRootOnSystem", () => {
  it("uses Application Support on macos", () => {
    const profileRoot = readMyChromeProfileRootOnSystem({
      operatingSystem: "macos",
      home: "/Users/a",
    });

    expect(profileRoot).toBe("/Users/a/Library/Application Support/Google/Chrome");
  });

  it("uses LOCALAPPDATA with backslashes on windows", () => {
    const profileRoot = readMyChromeProfileRootOnSystem({
      operatingSystem: "windows",
      home: "C:\\Users\\a",
      environment: { LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local" },
    });

    expect(profileRoot).toBe("C:\\Users\\a\\AppData\\Local\\Google\\Chrome\\User Data");
  });

  it("fails on windows when LOCALAPPDATA is unset", () => {
    expect(() =>
      readMyChromeProfileRootOnSystem({
        operatingSystem: "windows",
        home: "C:\\",
        environment: {},
      }),
    ).toThrow(/LOCALAPPDATA/);
  });

  it("uses .config on linux", () => {
    const profileRoot = readMyChromeProfileRootOnSystem({
      operatingSystem: "linux",
      home: "/home/a",
    });

    expect(profileRoot).toBe("/home/a/.config/google-chrome");
  });
});
