import { type ChildProcess, spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  readBridgeChromeProfileRoot,
  readChromeAppName,
  readConfiguredBrowserChoice,
  readDebugTargetFromActivePort,
  readMyChromeDebugTarget,
} from "./browser-profile.ts";
import {
  assertPortNotHeldByOwnChrome,
  BrowserAttachError,
  closeBrowserWithin,
  isDebugPortListening,
  isSameProfile,
  listChromeLaunchArgumentList,
  terminateChromeOnDebugPort,
} from "./browser-session.ts";

const startedProcesses: ChildProcess[] = [];
const startedServers: Server[] = [];

const startDebugPortServer = async (host: string): Promise<number> => {
  const debugServer = createServer((_request, reply) => {
    reply.writeHead(200, { "Content-Type": "application/json" });
    reply.end("{}");
  });
  startedServers.push(debugServer);
  await new Promise<void>((fulfillListen) => debugServer.listen(0, host, () => fulfillListen()));

  const address = debugServer.address();

  const isAddressMissing = address == null || typeof address === "string";
  if (isAddressMissing) throw new Error(`Test debug server has no port on ${host}`);

  return address.port;
};

const startProcessWithChromeSwitches = (port: number, profileRoot: string) => {
  const sleeper = spawn(process.execPath, [
    "-e",
    "console.log('ready'); setInterval(() => {}, 1000)",
    "--",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileRoot}`,
  ]);
  startedProcesses.push(sleeper);
  const exited = new Promise<void>((fulfillExit) => sleeper.once("exit", () => fulfillExit()));
  const ready = new Promise<void>((fulfillReady) =>
    sleeper.stdout.once("data", () => fulfillReady()),
  );
  return { sleeper, exited, ready };
};

afterEach(() => {
  for (const sleeper of startedProcesses.splice(0)) sleeper.kill();
  for (const debugServer of startedServers.splice(0)) debugServer.close();
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
    const portStaysOpen = createServer((_request, reply) => reply.end("{}"));
    await new Promise<void>((fulfillListen) =>
      portStaysOpen.listen(59313, "127.0.0.1", fulfillListen),
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

  it("reports the debug port as open when Chrome listens on IPv4 loopback", async () => {
    const port = await startDebugPortServer("127.0.0.1");

    await expect(isDebugPortListening({ port })).resolves.toBe(true);
  });

  it("reports the debug port as open when Chrome listens only on IPv6 loopback", async () => {
    const port = await startDebugPortServer("::1");

    await expect(isDebugPortListening({ port })).resolves.toBe(true);
  });

  it("gives up on a browser close that never finishes", async () => {
    const neverCloses = { close: () => new Promise<void>(() => {}) };
    await expect(closeBrowserWithin(neverCloses, 50)).resolves.toBeUndefined();
  });

  it("fails at once when your own Chrome names the port and answers 404 there", () => {
    const ownChrome = readDebugTargetFromActivePort("9222\n/devtools/browser/abc\n");
    expect(() => assertPortNotHeldByOwnChrome(9222, ownChrome, 404)).toThrow(/my-chrome/);
  });

  it("ignores a stale DevToolsActivePort file and the bridge Chrome's own answer", () => {
    const ownChrome = readDebugTargetFromActivePort("9222\n/devtools/browser/abc\n");
    expect(() => assertPortNotHeldByOwnChrome(9222, ownChrome, null)).not.toThrow();
    expect(() => assertPortNotHeldByOwnChrome(9222, ownChrome, 200)).not.toThrow();
    expect(() => assertPortNotHeldByOwnChrome(9333, ownChrome, 404)).not.toThrow();
    expect(() => assertPortNotHeldByOwnChrome(9222, undefined, 404)).not.toThrow();
  });

  it("names attach failures as BrowserAttachError", () => {
    const attachError = new BrowserAttachError("Chrome is already running");
    expect(attachError.name).toBe("BrowserAttachError");
    expect(attachError.message).toContain("already running");
  });

  it("compares resolved profile directories", () => {
    expect(isSameProfile("/tmp/a", "/tmp/a")).toBe(true);
    expect(isSameProfile("/tmp/a", "/tmp/b")).toBe(false);
  });

  it("builds launch args for one shared bridge Chrome profile by default", () => {
    const launchArgumentList = listChromeLaunchArgumentList(
      "https://chatgpt.com",
      "/tmp/bridge-profile",
    );

    expect(launchArgumentList).toContain("--remote-debugging-port=9222");
    expect(launchArgumentList).toContain("--remote-allow-origins=*");
    expect(launchArgumentList).toContain("--user-data-dir=/tmp/bridge-profile");
    expect(launchArgumentList).toContain("https://chatgpt.com");
  });

  it("disables extensions so connectOverCDP survives a Google-signed-in profile", () => {
    // Extension workers crash Playwright's connectOverCDP, so the launch disables extensions.
    const launchArgumentList = listChromeLaunchArgumentList(
      "https://labs.google/fx/tools/flow",
      "/tmp/bridge-profile",
    );

    expect(launchArgumentList).toContain("--disable-extensions");
    expect(launchArgumentList).toContain("--disable-component-extensions-with-background-pages");
    // The launch URL must remain the final positional argument.
    expect(launchArgumentList.at(-1)).toBe("https://labs.google/fx/tools/flow");
  });

  it("keeps the bridge Chrome profile global and not repo-local", () => {
    expect(readBridgeChromeProfileRoot()).toContain(".ai-browser-bridge/chrome-profile");
    expect(readBridgeChromeProfileRoot()).not.toContain(".bridge");
  });

  it("allows Chrome for Testing without changing the profile SSOT", () => {
    expect(readChromeAppName({})).toBe("Google Chrome");
    expect(
      readChromeAppName({
        AI_BROWSER_BRIDGE_CHROME_APP: " Google Chrome for Testing ",
      }),
    ).toBe("Google Chrome for Testing");
  });

  it("uses the bridge profile unless your own Chrome is chosen", () => {
    expect(readConfiguredBrowserChoice({})).toBe("bridge-profile");
    expect(readConfiguredBrowserChoice({ AI_BROWSER_BRIDGE_BROWSER: " my-chrome " })).toBe(
      "my-chrome",
    );
    expect(() => readConfiguredBrowserChoice({ AI_BROWSER_BRIDGE_BROWSER: "chrome" })).toThrow(
      'must be "bridge-profile" or "my-chrome"',
    );
  });

  it("reads your Chrome's websocket endpoint from DevToolsActivePort", () => {
    expect(readDebugTargetFromActivePort("9222\n/devtools/browser/4f1c-aa\n")).toEqual({
      port: 9222,
      endpoint: "ws://127.0.0.1:9222/devtools/browser/4f1c-aa",
    });
    expect(readDebugTargetFromActivePort("9222\n")).toBeUndefined();
    expect(readMyChromeDebugTarget("/no-such-chrome-data-dir")).toBeUndefined();
  });
});
