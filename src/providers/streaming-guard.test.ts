import type { Page } from "playwright";
import { describe, expect, it } from "vitest";
import { isReplyGenerating, waitForReplyIdle } from "./streaming-guard.ts";

const createFakePage = (visibility: boolean[]): { page: Page; locatorCallCount: () => number } => {
  let visibilityIndex = 0;
  let locatorCallCount = 0;
  const page = {
    locator: () => {
      locatorCallCount += 1;
      return {
        first: () => ({
          isVisible: () => {
            const lastIndex = visibility.length - 1;

            const isLastIndexNotFound = lastIndex < 0;
            if (isLastIndexNotFound) {
              visibilityIndex += 1;
              return Promise.resolve(false);
            }

            const index = Math.min(visibilityIndex, lastIndex);
            visibilityIndex += 1;
            const stopControlVisible = visibility[index];

            const isStopControlVisibleMissing = stopControlVisible == null;
            if (isStopControlVisibleMissing) return Promise.resolve(false);

            return Promise.resolve(stopControlVisible);
          },
        }),
      };
    },
    waitForTimeout: () => Promise.resolve(),
  } as unknown as Page;
  return { page, locatorCallCount: () => locatorCallCount };
};

describe("isReplyGenerating", () => {
  it("reports not generating without touching the page when no stop selector exists", async () => {
    const { page, locatorCallCount } = createFakePage([true]);
    expect(await isReplyGenerating(page, "")).toBe(false);
    expect(locatorCallCount()).toBe(0);
  });

  it("reports generating while the stop control is visible", async () => {
    const { page } = createFakePage([true]);
    expect(await isReplyGenerating(page, "button.stop")).toBe(true);
  });

  it("reports not generating while the stop control is hidden", async () => {
    const { page } = createFakePage([false]);
    expect(await isReplyGenerating(page, "button.stop")).toBe(false);
  });
});

describe("waitForReplyIdle", () => {
  it("resolves immediately without touching the page when no stop selector exists", async () => {
    const { page, locatorCallCount } = createFakePage([true]);
    await waitForReplyIdle(page, "");
    expect(locatorCallCount()).toBe(0);
  });

  it("resolves once the stop control stays gone across confirmation polls", async () => {
    const { page } = createFakePage([false, false]);
    await expect(waitForReplyIdle(page, "button.stop", 5_000)).resolves.toBeUndefined();
  });

  it("keeps waiting when the stop control flickers back before confirming idle", async () => {
    const { page } = createFakePage([false, true, false, false]);
    await expect(waitForReplyIdle(page, "button.stop", 5_000)).resolves.toBeUndefined();
  });

  it("throws when a response never finishes within the timeout budget", async () => {
    const { page } = createFakePage([true]);
    await expect(waitForReplyIdle(page, "button.stop", 0)).rejects.toThrow(/finish before sending/);
  });
});
