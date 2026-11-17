import { describe, expect, it } from "vitest";
import { copyTextToClipboard } from "@/operating-system/copy-text-to-clipboard.ts";

function createMissingCommandError(): Error {
  return Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
}

function createFakeRunner(installedCommands: string[]) {
  const calls: { command: string; argumentList: string[]; inputText: string }[] = [];
  async function runCommand(command: string, argumentList: string[], inputText: string) {
    calls.push({ command, argumentList, inputText });

    const isCommandMissing = !installedCommands.includes(command);
    if (isCommandMissing) throw createMissingCommandError();
  }
  return { calls, runCommand };
}

describe("copyTextToClipboard", () => {
  it("pipes the text into pbcopy on macos", async () => {
    const fakeRunner = createFakeRunner(["pbcopy"]);

    await copyTextToClipboard({
      clipboardText: "hi",
      operatingSystem: "macos",
      runCommand: fakeRunner.runCommand,
    });

    expect(fakeRunner.calls).toEqual([{ command: "pbcopy", argumentList: [], inputText: "hi" }]);
  });

  it("uses Set-Clipboard through PowerShell on windows", async () => {
    const fakeRunner = createFakeRunner(["powershell"]);

    await copyTextToClipboard({
      clipboardText: "hi",
      operatingSystem: "windows",
      runCommand: fakeRunner.runCommand,
    });

    const [call] = fakeRunner.calls;
    expect(call?.command).toBe("powershell");
    expect(call?.argumentList.join(" ")).toContain("Set-Clipboard");
    expect(call?.inputText).toBe("hi");
  });

  it("tries wl-copy first when WAYLAND_DISPLAY is set", async () => {
    const fakeRunner = createFakeRunner(["wl-copy", "xclip"]);

    await copyTextToClipboard({
      clipboardText: "hi",
      operatingSystem: "linux",
      environment: { WAYLAND_DISPLAY: "wayland-0" },
      runCommand: fakeRunner.runCommand,
    });

    expect(fakeRunner.calls.map((call) => call.command)).toEqual(["wl-copy"]);
  });

  it("skips wl-copy without Wayland and falls back from xclip to xsel", async () => {
    const fakeRunner = createFakeRunner(["xsel"]);

    await copyTextToClipboard({
      clipboardText: "hi",
      operatingSystem: "linux",
      environment: {},
      runCommand: fakeRunner.runCommand,
    });

    expect(fakeRunner.calls.map((call) => call.command)).toEqual(["xclip", "xsel"]);
    expect(fakeRunner.calls[1]?.argumentList).toEqual(["--clipboard", "--input"]);
  });

  it("names the packages to install when no tool exists on linux", async () => {
    const fakeRunner = createFakeRunner([]);

    await expect(
      copyTextToClipboard({
        clipboardText: "hi",
        operatingSystem: "linux",
        environment: {},
        runCommand: fakeRunner.runCommand,
      }),
    ).rejects.toThrow(/wl-clipboard or xclip/);
  });

  it("stops on an error that is not a missing command", async () => {
    async function runCommand() {
      throw new Error("clipboard is locked");
    }

    await expect(
      copyTextToClipboard({
        clipboardText: "hi",
        operatingSystem: "linux",
        environment: {},
        runCommand,
      }),
    ).rejects.toThrow(/locked/);
  });
});
