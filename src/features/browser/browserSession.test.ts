import { describe, expect, it } from "vitest";
import {
  BrowserAttachError,
  bridgeChromeProfileRoot,
  chromeAppName,
  chromeLaunchArgs,
  isDebugPortListening,
  profilesMatch,
} from "./index.ts";

describe("browser session", () => {
  it("reports the debug port as closed when nothing listens", async () => {
    await expect(isDebugPortListening({ port: 59222 })).resolves.toBe(false);
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
});
