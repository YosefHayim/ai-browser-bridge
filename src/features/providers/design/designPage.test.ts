import type { Page } from "playwright";
import { describe, expect, it, vi } from "vitest";
import { designProvider } from "./designPage.ts";
import { markDesignTurnStarted } from "./designTabs.ts";

// A project tab whose stop pill is showing — a turn is running in it.
const busyProjectTab = () => {
  const click = vi.fn(async () => undefined);
  const page = {
    url: () => "https://claude.ai/design/p/p1",
    locator: () => ({ first: () => ({ isVisible: async () => true, click }) }),
  } as unknown as Page;
  return { page, click };
};

describe("designProvider.injectPrompt", () => {
  it("refuses to send while another tab of the same project runs a turn", async () => {
    const click = vi.fn(async () => undefined);
    const idleTab = {
      url: () => "https://claude.ai/design/p/p1",
      locator: () => ({ first: () => ({ isVisible: async () => false, click }) }),
      context: () => ({ pages: () => [idleTab, busyProjectTab().page] }),
    } as unknown as Page;

    await expect(designProvider.injectPrompt(idleTab, "bigger title")).rejects.toThrow(
      /project p1 is running a turn/,
    );
    expect(click).not.toHaveBeenCalled();
  });
});

describe("designProvider.stopGenerating", () => {
  it("leaves a turn it did not start running", async () => {
    const { page, click } = busyProjectTab();

    expect(await designProvider.stopGenerating(page)).toBe(false);
    expect(click).not.toHaveBeenCalled();
  });

  it("stops a turn this process started through the engine", async () => {
    const { page, click } = busyProjectTab();
    markDesignTurnStarted(page, 0);

    expect(await designProvider.stopGenerating(page)).toBe(true);
    expect(click).toHaveBeenCalledOnce();
    expect(await designProvider.stopGenerating(page)).toBe(false);
  });
});
