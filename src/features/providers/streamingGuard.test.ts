import type { Page } from "playwright";
import { describe, expect, it } from "vitest";
import { isResponseGenerating, waitForResponseIdle } from "./streamingGuard.ts";

/** Fake page whose stop control returns the queued visibility values (last value repeats),
 *  and that counts locator calls so tests can prove the page is left untouched. */
const fakePage = (visibility: boolean[]): { page: Page; locatorCalls: () => number } => {
  let index = 0;
  let calls = 0;
  const page = {
    locator: () => {
      calls += 1;
      return {
        first: () => ({
          isVisible: () => {
            const value = visibility[Math.min(index, visibility.length - 1)] ?? false;
            index += 1;
            return Promise.resolve(value);
          },
        }),
      };
    },
    waitForTimeout: () => Promise.resolve(),
  } as unknown as Page;
  return { page, locatorCalls: () => calls };
};

describe("isResponseGenerating", () => {
  it("reports not generating without touching the page when no stop selector exists", async () => {
    const { page, locatorCalls } = fakePage([true]);
    expect(await isResponseGenerating(page, "")).toBe(false);
    expect(locatorCalls()).toBe(0);
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
    const { page, locatorCalls } = fakePage([true]);
    await waitForResponseIdle(page, "");
    expect(locatorCalls()).toBe(0);
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
