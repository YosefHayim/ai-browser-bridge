import { describe, expect, it } from "vitest";
import {
  BrowserAttachError,
  bridgeChromeProfileRoot,
  buildChromeLaunchArgs,
  chromeAppName,
  isDebugPortListening,
  profilesMatch,
} from "./index.ts";

describe("browser manager helpers", () => {
  it("isDebugPortListening returns false when nothing listens on the port", async () => {
    await expect(isDebugPortListening(59222)).resolves.toBe(false);
  });

  it("BrowserAttachError names the attach failure", () => {
    const err = new BrowserAttachError("Chrome is already running");
    expect(err.name).toBe("BrowserAttachError");
    expect(err.message).toContain("already running");
  });

  it("profilesMatch compares resolved profile directories", () => {
    expect(profilesMatch("/tmp/a", "/tmp/a")).toBe(true);
    expect(profilesMatch("/tmp/a", "/tmp/b")).toBe(false);
  });

  it("launch args use one shared bridge Chrome profile by default", () => {
    const args = buildChromeLaunchArgs("https://chatgpt.com", "/tmp/bridge-profile");

    expect(args).toContain("--remote-debugging-port=9222");
    expect(args).toContain("--user-data-dir=/tmp/bridge-profile");
    expect(args).toContain("https://chatgpt.com");
  });

  it("bridgeChromeProfileRoot is global and not repo-local", () => {
    expect(bridgeChromeProfileRoot()).toContain(".ai-browser-bridge/chrome-profile");
    expect(bridgeChromeProfileRoot()).not.toContain(".bridge");
  });

  it("chromeAppName allows Chrome for Testing without changing the profile SSOT", () => {
    expect(chromeAppName({})).toBe("Google Chrome");
    expect(
      chromeAppName({
        AI_BROWSER_BRIDGE_CHROME_APP: " Google Chrome for Testing ",
      }),
    ).toBe("Google Chrome for Testing");
  });
});
