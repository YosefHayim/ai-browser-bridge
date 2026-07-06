import { describe, expect, it } from "vitest";
import { readBrowserStatus } from "./browserState.ts";

describe("browser state helpers", () => {
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
});
