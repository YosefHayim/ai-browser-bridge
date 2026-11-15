import { describe, expect, it } from "vitest";
import { findChromeExecutable } from "@/operating-system/find-chrome-executable.ts";

describe("findChromeExecutable", () => {
  it("prefers the configured path", () => {
    const chromePath = findChromeExecutable({
      operatingSystem: "linux",
      environment: { AI_BROWSER_BRIDGE_CHROME_PATH: "/opt/chrome" },
      fileExists: () => false,
    });

    expect(chromePath).toBe("/opt/chrome");
  });

  it("checks the windows install folders in order and skips unset ones", () => {
    const checkedPaths: string[] = [];
    const chromePath = findChromeExecutable({
      operatingSystem: "windows",
      environment: { "ProgramFiles(x86)": "C:\\Program Files (x86)", LOCALAPPDATA: "C:\\Local" },
      fileExists: (path) => {
        checkedPaths.push(path);
        return path.startsWith("C:\\Local");
      },
    });

    expect(checkedPaths).toEqual([
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Local\\Google\\Chrome\\Application\\chrome.exe",
    ]);
    expect(chromePath).toBe("C:\\Local\\Google\\Chrome\\Application\\chrome.exe");
  });

  it("searches PATH for the linux chrome names", () => {
    const chromePath = findChromeExecutable({
      operatingSystem: "linux",
      environment: { PATH: "/usr/local/bin:/usr/bin" },
      fileExists: (path) => path === "/usr/bin/chromium",
    });

    expect(chromePath).toBe("/usr/bin/chromium");
  });

  it("uses the app name on macos", () => {
    const defaultPath = findChromeExecutable({
      operatingSystem: "macos",
      environment: {},
      fileExists: () => true,
    });
    const namedPath = findChromeExecutable({
      operatingSystem: "macos",
      environment: { AI_BROWSER_BRIDGE_CHROME_APP: "Chromium" },
      fileExists: () => true,
    });

    expect(defaultPath).toBe("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
    expect(namedPath).toBe("/Applications/Chromium.app/Contents/MacOS/Chromium");
  });

  it("lists every checked path and the setting name when nothing is found", () => {
    expect(() =>
      findChromeExecutable({
        operatingSystem: "windows",
        environment: { ProgramFiles: "C:\\PF" },
        fileExists: () => false,
      }),
    ).toThrow(/C:\\PF\\Google\\Chrome\\Application\\chrome\.exe.*AI_BROWSER_BRIDGE_CHROME_PATH/);
  });

  it("explains an empty PATH on linux", () => {
    expect(() =>
      findChromeExecutable({ operatingSystem: "linux", environment: {}, fileExists: () => false }),
    ).toThrow(/AI_BROWSER_BRIDGE_CHROME_PATH/);
  });
});
