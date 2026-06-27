import { describe, expect, it } from "vitest";
import { BrowserAttachError, isDebugPortListening } from "../../src/browser/manager.ts";

describe("browser manager helpers", () => {
  it("isDebugPortListening returns false when nothing listens on the port", async () => {
    await expect(isDebugPortListening(59222)).resolves.toBe(false);
  });

  it("BrowserAttachError names the attach failure", () => {
    const err = new BrowserAttachError("Chrome is already running");
    expect(err.name).toBe("BrowserAttachError");
    expect(err.message).toContain("already running");
  });
});
