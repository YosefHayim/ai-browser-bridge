import type { Page } from "playwright";
import { describe, expect, it, vi } from "vitest";
import { stallReloadWatchdogFor } from "./renderStallWatchdog.ts";

const pageWithReload = (reload: ReturnType<typeof vi.fn>): Page => ({ reload }) as unknown as Page;

describe("stallReloadWatchdogFor", () => {
  it("does not reload before the stall threshold", async () => {
    let clock = 0;
    const reload = vi.fn().mockResolvedValue(undefined);
    const page = pageWithReload(reload);
    const watchdog = stallReloadWatchdogFor({ stallMs: 1_000, now: () => clock });
    clock = 999;
    expect(await watchdog.maybeReload(page)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads once the stall threshold is crossed", async () => {
    let clock = 0;
    const reload = vi.fn().mockResolvedValue(undefined);
    const page = pageWithReload(reload);
    const watchdog = stallReloadWatchdogFor({ stallMs: 1_000, now: () => clock });
    clock = 1_000;
    expect(await watchdog.maybeReload(page)).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("resets the stall clock when progress is noted", async () => {
    let clock = 0;
    const reload = vi.fn().mockResolvedValue(undefined);
    const page = pageWithReload(reload);
    const watchdog = stallReloadWatchdogFor({ stallMs: 1_000, now: () => clock });
    clock = 900;
    watchdog.noteProgress();
    clock = 1_800;
    expect(await watchdog.maybeReload(page)).toBe(false);
    clock = 1_900;
    expect(await watchdog.maybeReload(page)).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("caps reloads at maxReloads", async () => {
    let clock = 0;
    const reload = vi.fn().mockResolvedValue(undefined);
    const page = pageWithReload(reload);
    const watchdog = stallReloadWatchdogFor({ stallMs: 100, maxReloads: 2, now: () => clock });
    clock = 100;
    expect(await watchdog.maybeReload(page)).toBe(true); // reload 1, resets clock to 100
    clock = 200;
    expect(await watchdog.maybeReload(page)).toBe(true); // reload 2, resets clock to 200
    clock = 300;
    expect(await watchdog.maybeReload(page)).toBe(false); // capped
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("runs waitAfterReload then onReload after a reload", async () => {
    let clock = 0;
    const order: string[] = [];
    const reload = vi.fn().mockResolvedValue(undefined);
    const page = pageWithReload(reload);
    const watchdog = stallReloadWatchdogFor({
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
