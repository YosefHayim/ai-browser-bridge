import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { debugTargetFromActivePort, myChromeDebugTarget } from "./browserProfile.ts";
import {
  BrowserAttachError,
  bridgeChromeProfileRoot,
  chromeAppName,
  chromeLaunchArgs,
  closeBrowserWithin,
  configuredBrowserChoice,
  isDebugPortListening,
  profilesMatch,
  terminateChromeOnDebugPort,
} from "./index.ts";

const startedProcesses: ChildProcess[] = [];

const startProcessWithChromeSwitches = (port: number, profileRoot: string) => {
  const sleeper = spawn(process.execPath, [
    "-e",
    "console.log('ready'); setInterval(() => {}, 1000)",
    "--",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileRoot}`,
  ]);
  startedProcesses.push(sleeper);
  const exited = new Promise<void>((resolveExit) => sleeper.once("exit", () => resolveExit()));
  const ready = new Promise<void>((resolveReady) =>
    sleeper.stdout.once("data", () => resolveReady()),
  );
  return { sleeper, exited, ready };
};

afterEach(() => {
  for (const sleeper of startedProcesses.splice(0)) sleeper.kill();
});

describe("browser session", () => {
  it("stops only the process with that debug-port switch and the bridge profile", async () => {
    const bridgeChrome = startProcessWithChromeSwitches(59311, "/profiles/bridge-a");
    const sameProfileOtherPort = startProcessWithChromeSwitches(593110, "/profiles/bridge-a");
    const ownChrome = startProcessWithChromeSwitches(59311, "/profiles/own-chrome");
    await Promise.all([bridgeChrome.ready, sameProfileOtherPort.ready, ownChrome.ready]);

    await expect(terminateChromeOnDebugPort(59311, "/profiles/bridge-a")).resolves.toBe(true);
    await bridgeChrome.exited;
    expect(sameProfileOtherPort.sleeper.exitCode).toBeNull();
    expect(sameProfileOtherPort.sleeper.signalCode).toBeNull();
    expect(ownChrome.sleeper.exitCode).toBeNull();
    expect(ownChrome.sleeper.signalCode).toBeNull();
  });

  it("fails when the debug port stays open after the bridge Chrome is stopped", async () => {
    const portStaysOpen = createServer((_request, response) => response.end("{}"));
    await new Promise<void>((resolveListen) =>
      portStaysOpen.listen(59313, "127.0.0.1", resolveListen),
    );
    const bridgeChrome = startProcessWithChromeSwitches(59313, "/profiles/bridge-a");
    await bridgeChrome.ready;

    try {
      await expect(terminateChromeOnDebugPort(59313, "/profiles/bridge-a")).rejects.toThrow(
        /still open/,
      );
    } finally {
      portStaysOpen.close();
    }
  }, 20_000);

  it("reports nothing stopped when no process has the debug-port switch", async () => {
    await expect(terminateChromeOnDebugPort(59312, "/profiles/bridge-a")).resolves.toBe(false);
  });

  it("reports the debug port as closed when nothing listens", async () => {
    await expect(isDebugPortListening({ port: 59222 })).resolves.toBe(false);
  });

  it("gives up on a browser close that never finishes", async () => {
    const neverCloses = { close: () => new Promise<void>(() => {}) };
    await expect(closeBrowserWithin(neverCloses, 50)).resolves.toBeUndefined();
  });

  it("names attach failures as BrowserAttachError", () => {
    const attachError = new BrowserAttachError("Chrome is already running");
    expect(attachError.name).toBe("BrowserAttachError");
    expect(attachError.message).toContain("already running");
  });

  it("compares resolved profile directories", () => {
    expect(profilesMatch("/tmp/a", "/tmp/a")).toBe(true);
    expect(profilesMatch("/tmp/a", "/tmp/b")).toBe(false);
  });

  it("builds launch args for one shared bridge Chrome profile by default", () => {
    const launchArgs = chromeLaunchArgs("https://chatgpt.com", "/tmp/bridge-profile");

    expect(launchArgs).toContain("--remote-debugging-port=9222");
    expect(launchArgs).toContain("--remote-allow-origins=*");
    expect(launchArgs).toContain("--user-data-dir=/tmp/bridge-profile");
    expect(launchArgs).toContain("https://chatgpt.com");
  });

  it("disables extensions so connectOverCDP survives a Google-signed-in profile", () => {
    // Extension service workers attach as CDP targets without a browserContextId and
    // crash Playwright's connectOverCDP; Gemini/Flow require Google sign-in, which pulls
    // in those workers. Disabling extensions keeps every provider attachable.
    const launchArgs = chromeLaunchArgs("https://labs.google/fx/tools/flow", "/tmp/bridge-profile");

    expect(launchArgs).toContain("--disable-extensions");
    expect(launchArgs).toContain("--disable-component-extensions-with-background-pages");
    // The launch URL must remain the final positional argument.
    expect(launchArgs.at(-1)).toBe("https://labs.google/fx/tools/flow");
  });

  it("keeps the bridge Chrome profile global and not repo-local", () => {
    expect(bridgeChromeProfileRoot()).toContain(".ai-browser-bridge/chrome-profile");
    expect(bridgeChromeProfileRoot()).not.toContain(".bridge");
  });

  it("allows Chrome for Testing without changing the profile SSOT", () => {
    expect(chromeAppName({})).toBe("Google Chrome");
    expect(
      chromeAppName({
        AI_BROWSER_BRIDGE_CHROME_APP: " Google Chrome for Testing ",
      }),
    ).toBe("Google Chrome for Testing");
  });

  it("uses the bridge profile unless your own Chrome is chosen", () => {
    expect(configuredBrowserChoice({})).toBe("bridge-profile");
    expect(configuredBrowserChoice({ AI_BROWSER_BRIDGE_BROWSER: " my-chrome " })).toBe("my-chrome");
    expect(() => configuredBrowserChoice({ AI_BROWSER_BRIDGE_BROWSER: "chrome" })).toThrow(
      'must be "bridge-profile" or "my-chrome"',
    );
  });

  it("reads your Chrome's websocket endpoint from DevToolsActivePort", () => {
    expect(debugTargetFromActivePort("9222\n/devtools/browser/4f1c-aa\n")).toEqual({
      port: 9222,
      endpoint: "ws://127.0.0.1:9222/devtools/browser/4f1c-aa",
    });
    expect(debugTargetFromActivePort("9222\n")).toBeUndefined();
    expect(myChromeDebugTarget("/no-such-chrome-data-dir")).toBeUndefined();
  });
});
