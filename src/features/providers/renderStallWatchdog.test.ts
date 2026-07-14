import type { Page } from "playwright";
import { describe, expect, it, vi } from "vitest";
import { createStallReloadWatchdog } from "./renderStallWatchdog.ts";

/** Fake page exposing only the `reload` the watchdog touches, plus a spy for assertions. */
const fakePage = (): { page: Page; reload: ReturnType<typeof vi.fn> } => {
  const reload = vi.fn(async () => {});
  return { page: { reload } as unknown as Page, reload };
};

describe("createStallReloadWatchdog", () => {
  it("does not reload before the stall threshold elapses", async () => {
    let clock = 0;
    const { page, reload } = fakePage();
    const watchdog = createStallReloadWatchdog({ stallMs: 1_000, now: () => clock });
    clock = 999;
    expect(await watchdog.maybeReload(page)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads once no progress has been seen for stallMs", async () => {
    let clock = 0;
    const { page, reload } = fakePage();
    const watchdog = createStallReloadWatchdog({ stallMs: 1_000, now: () => clock });
    clock = 1_000;
    expect(await watchdog.maybeReload(page)).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("noteProgress resets the stall clock", async () => {
    let clock = 0;
    const { page, reload } = fakePage();
    const watchdog = createStallReloadWatchdog({ stallMs: 1_000, now: () => clock });
    clock = 900;
    watchdog.noteProgress();
    clock = 1_899; // 999ms since progress — still under threshold
    expect(await watchdog.maybeReload(page)).toBe(false);
    clock = 1_900; // 1000ms since progress — reload
    expect(await watchdog.maybeReload(page)).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("stops reloading after maxReloads", async () => {
    let clock = 0;
    const { page, reload } = fakePage();
    const watchdog = createStallReloadWatchdog({ stallMs: 100, maxReloads: 2, now: () => clock });
    clock = 100;
    expect(await watchdog.maybeReload(page)).toBe(true); // reload 1, resets clock to 100
    clock = 200;
    expect(await watchdog.maybeReload(page)).toBe(true); // reload 2, resets clock to 200
    clock = 300;
    expect(await watchdog.maybeReload(page)).toBe(false); // capped
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("awaits waitAfterReload before firing onReload with the running count", async () => {
    let clock = 0;
    const order: string[] = [];
    const { page } = fakePage();
    const watchdog = createStallReloadWatchdog({
      stallMs: 100,
      now: () => clock,
      waitAfterReload: async () => {
        order.push("wait");
      },
      onReload: (count) => {
        order.push(`reload:${count}`);
      },
    });
    clock = 100;
    await watchdog.maybeReload(page);
    expect(order).toEqual(["wait", "reload:1"]);
  });
});
