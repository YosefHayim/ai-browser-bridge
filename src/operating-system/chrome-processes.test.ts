import { describe, expect, it } from "vitest";
import {
  isChromeInProcessList,
  listChromeProcesses,
  parsePsOutput,
  parseWindowsProcessOutput,
} from "@/operating-system/chrome-processes.ts";

describe("parsePsOutput", () => {
  it("reads the pid and command line of each line", () => {
    const chromeProcesses = parsePsOutput("  101 /usr/bin/chromium --flag\n7 node\n\n");

    expect(chromeProcesses).toEqual([
      { pid: 101, commandLine: "/usr/bin/chromium --flag" },
      { pid: 7, commandLine: "node" },
    ]);
  });

  it("returns nothing for empty output", () => {
    expect(parsePsOutput("")).toEqual([]);
  });
});

describe("parseWindowsProcessOutput", () => {
  it("returns nothing when PowerShell prints nothing", () => {
    expect(parseWindowsProcessOutput("  \r\n")).toEqual([]);
  });

  it("reads a single object that is not an array", () => {
    const powershellOutput = JSON.stringify({ ProcessId: 12, CommandLine: "chrome.exe --a" });

    expect(parseWindowsProcessOutput(powershellOutput)).toEqual([
      { pid: 12, commandLine: "chrome.exe --a" },
    ]);
  });

  it("reads an array and turns a null command line into an empty one", () => {
    const powershellOutput = JSON.stringify([
      { ProcessId: 1, CommandLine: "chrome.exe" },
      { ProcessId: 2, CommandLine: null },
    ]);

    expect(parseWindowsProcessOutput(powershellOutput)).toEqual([
      { pid: 1, commandLine: "chrome.exe" },
      { pid: 2, commandLine: "" },
    ]);
  });
});

describe("listChromeProcesses", () => {
  it("runs ps on macos and linux", async () => {
    const commands: string[] = [];
    const runCommand = async (command: string, argumentList: string[]) => {
      commands.push([command, ...argumentList].join(" "));
      return "5 chrome\n";
    };

    const macosProcesses = await listChromeProcesses("macos", runCommand);
    const linuxProcesses = await listChromeProcesses("linux", runCommand);

    expect(commands).toEqual(["ps ax -o pid=,command=", "ps ax -o pid=,command="]);
    expect(macosProcesses).toEqual([{ pid: 5, commandLine: "chrome" }]);
    expect(linuxProcesses).toEqual(macosProcesses);
  });

  it("runs PowerShell on windows", async () => {
    let usedCommand = "";
    const runCommand = async (command: string) => {
      usedCommand = command;
      return JSON.stringify({ ProcessId: 9, CommandLine: "chrome.exe" });
    };

    const chromeProcesses = await listChromeProcesses("windows", runCommand);

    expect(usedCommand).toBe("powershell");
    expect(chromeProcesses).toEqual([{ pid: 9, commandLine: "chrome.exe" }]);
  });
});

describe("isChromeInProcessList", () => {
  const chromeProcesses = [
    { pid: 1, commandLine: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --x" },
    { pid: 2, commandLine: "/usr/bin/chromium --y" },
  ];

  it("finds the app folder on macos", () => {
    const isMacosFound = isChromeInProcessList({
      chromeProcesses,
      operatingSystem: "macos",
      macosAppName: "Google Chrome",
    });
    const isOtherAppFound = isChromeInProcessList({
      chromeProcesses,
      operatingSystem: "macos",
      macosAppName: "Brave",
    });

    expect(isMacosFound).toBe(true);
    expect(isOtherAppFound).toBe(false);
  });

  it("counts any chrome.exe process on windows", () => {
    const base = { operatingSystem: "windows", macosAppName: "x" } as const;

    expect(isChromeInProcessList({ ...base, chromeProcesses })).toBe(true);
    expect(isChromeInProcessList({ ...base, chromeProcesses: [] })).toBe(false);
  });

  it("matches the executable name on linux", () => {
    const base = { operatingSystem: "linux", macosAppName: "x" } as const;
    const bashProcesses = [{ pid: 3, commandLine: "/bin/bash -c" }];

    expect(isChromeInProcessList({ ...base, chromeProcesses })).toBe(true);
    expect(isChromeInProcessList({ ...base, chromeProcesses: bashProcesses })).toBe(false);
  });
});
