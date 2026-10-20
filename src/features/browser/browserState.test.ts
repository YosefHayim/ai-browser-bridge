import { describe, expect, it } from "vitest";
import { readBrowserStatus } from "./browserState.ts";

describe("browser status", () => {
  it("reports ready when the Chrome debug port is reachable", async () => {
    const status = await readBrowserStatus(
      { port: 9333 },
      {
        bridgeChromeProfileRoot: () => "/Users/me/.ai-browser-bridge/chrome-profile",
        getUserDataDirOnDebugPort: async () => null,
        isChromeProcessRunning: async () => true,
        isDebugPortListening: async () => true,
      },
    );

    expect(status.state).toBe("ready");
    expect(status.canAttach).toBe(true);
    expect(status.port).toBe(9333);
  });

  it("reports a running Chrome that was not started with the debug port", async () => {
    const status = await readBrowserStatus(
      { port: 9444 },
      {
        bridgeChromeProfileRoot: () => "/profile",
        getUserDataDirOnDebugPort: async () => null,
        isChromeProcessRunning: async () => true,
        isDebugPortListening: async () => false,
      },
    );

    expect(status.state).toBe("chrome-running-without-debug");
    expect(status.canAttach).toBe(false);
    expect(status.message).toContain("bridge chrome start");
    expect(status.message).not.toContain("Quit Chrome");
  });

  it("reports Chrome not running when neither process nor debug port exists", async () => {
    const status = await readBrowserStatus(
      {},
      {
        bridgeChromeProfileRoot: () => "/profile",
        getUserDataDirOnDebugPort: async () => null,
        isChromeProcessRunning: async () => false,
        isDebugPortListening: async () => false,
      },
    );

    expect(status.state).toBe("chrome-not-running");
    expect(status.canAttach).toBe(false);
  });

  it("reports your own Chrome ready once its remote debugging is on", async () => {
    const status = await readBrowserStatus(
      { browserChoice: "my-chrome" },
      {
        bridgeChromeProfileRoot: () => "/profile",
        isChromeProcessRunning: async () => true,
        myChromeDebugTarget: () => ({
          port: 9229,
          endpoint: "ws://127.0.0.1:9229/devtools/browser/abc",
        }),
      },
    );

    expect(status.state).toBe("ready");
    expect(status.canAttach).toBe(true);
    expect(status.port).toBe(9229);
    expect(status.userDataDir).toContain("Library/Application Support/Google/Chrome");
  });

  it("tells you to turn on remote debugging in your own Chrome", async () => {
    const status = await readBrowserStatus(
      { browserChoice: "my-chrome" },
      {
        bridgeChromeProfileRoot: () => "/profile",
        isChromeProcessRunning: async () => true,
        myChromeDebugTarget: () => undefined,
      },
    );

    expect(status.state).toBe("chrome-running-without-debug");
    expect(status.canAttach).toBe(false);
    expect(status.message).toContain("chrome://inspect/#remote-debugging");
  });
});
