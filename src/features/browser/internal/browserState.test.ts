import { describe, expect, it } from "vitest";
import { readBrowserStatus } from "./browserState.ts";

describe("browser state helpers", () => {
  it("reports ready when the Chrome debug port is reachable", async () => {
    const status = await readBrowserStatus(
      { port: 9333 },
      {
        defaultChromeProfileRoot: () => "/Users/me/Library/Application Support/Google/Chrome",
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
        defaultChromeProfileRoot: () => "/profile",
        getUserDataDirOnDebugPort: async () => null,
        isChromeProcessRunning: async () => true,
        isDebugPortListening: async () => false,
      },
    );

    expect(status.state).toBe("chrome-running-without-debug");
    expect(status.canAttach).toBe(false);
    expect(status.message).toContain("bridge chrome start");
  });

  it("reports Chrome not running when neither process nor debug port exists", async () => {
    const status = await readBrowserStatus(
      {},
      {
        defaultChromeProfileRoot: () => "/profile",
        getUserDataDirOnDebugPort: async () => null,
        isChromeProcessRunning: async () => false,
        isDebugPortListening: async () => false,
      },
    );

    expect(status.state).toBe("chrome-not-running");
    expect(status.canAttach).toBe(false);
  });
});
