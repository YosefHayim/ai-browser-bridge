import type { Page } from "playwright";
import { describe, expect, it } from "vitest";
import { isResponseGenerating, waitForResponseIdle } from "./streamingGuard.ts";

/** Fake page that walks a queue of stop-control visibility values (last value repeats). */
const fakePage = (visibility: boolean[]): { page: Page; locatorCallCount: () => number } => {
  let visibilityIndex = 0;
  let locatorCallCount = 0;
  const page = {
    locator: () => {
      locatorCallCount += 1;
      return {
        first: () => ({
          isVisible: () => {
            const lastIndex = visibility.length - 1;
            if (lastIndex < 0) {
              visibilityIndex += 1;
              return Promise.resolve(false);
            }
            const index = Math.min(visibilityIndex, lastIndex);
            visibilityIndex += 1;
            const stopControlVisible = visibility[index];
            if (stopControlVisible === undefined) return Promise.resolve(false);
            return Promise.resolve(stopControlVisible);
          },
        }),
      };
    },
    waitForTimeout: () => Promise.resolve(),
  } as unknown as Page;
  return { page, locatorCallCount: () => locatorCallCount };
};

describe("isResponseGenerating", () => {
  it("reports not generating without touching the page when no stop selector exists", async () => {
    const { page, locatorCallCount } = fakePage([true]);
    expect(await isResponseGenerating(page, "")).toBe(false);
    expect(locatorCallCount()).toBe(0);
  });

  it("reports generating while the stop control is visible", async () => {
    const { page } = fakePage([true]);
    expect(await isResponseGenerating(page, "button.stop")).toBe(true);
  });

  it("reports not generating while the stop control is hidden", async () => {
    const { page } = fakePage([false]);
    expect(await isResponseGenerating(page, "button.stop")).toBe(false);
  });
});

describe("waitForResponseIdle", () => {
  it("resolves immediately without touching the page when no stop selector exists", async () => {
    const { page, locatorCallCount } = fakePage([true]);
    await waitForResponseIdle(page, "");
    expect(locatorCallCount()).toBe(0);
  });

  it("resolves once the stop control stays gone across confirmation polls", async () => {
    const { page } = fakePage([false, false]);
    await expect(waitForResponseIdle(page, "button.stop", 5_000)).resolves.toBeUndefined();
  });

  it("keeps waiting when the stop control flickers back before confirming idle", async () => {
    // false (streak 1) → true (reset) → false (streak 1) → false (streak 2 → idle).
    const { page } = fakePage([false, true, false, false]);
    await expect(waitForResponseIdle(page, "button.stop", 5_000)).resolves.toBeUndefined();
  });

  it("throws when a response never finishes within the timeout budget", async () => {
    const { page } = fakePage([true]);
    await expect(waitForResponseIdle(page, "button.stop", 0)).rejects.toThrow(
      /finish before sending/,
    );
  });
});
