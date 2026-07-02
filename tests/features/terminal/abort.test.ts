import { describe, expect, it } from "vitest";
import { abortAndExit } from "../../../src/features/terminal/cliRunner.ts";

/** Sentinel thrown by the fake `exit` so we can assert the call happened without ending the test process. */
class ExitSignal extends Error {
  constructor(readonly code: number) {
    super(`exit(${code})`);
  }
}

/** Build a fake engine that records the order of stop/shutdown calls into `order`. */
function makeEngine(order: string[], options: { stopRejects?: boolean } = {}) {
  return {
    getOrchestrator: () => ({
      stopResponse: async () => {
        order.push("abort");
        if (options.stopRejects) throw new Error("abort failed");
        return true;
      },
    }),
    shutdown: async (opts?: { closeBrowser?: boolean }) => {
      order.push(`shutdown:${opts?.closeBrowser ?? false}`);
    },
  };
}

/** A `(code: number) => never` that throws a sentinel so the test process keeps running. */
const fakeExit =
  (order: string[]): ((code: number) => never) =>
  (code) => {
    order.push(`exit:${code}`);
    throw new ExitSignal(code);
  };

describe("abortAndExit", () => {
  it("aborts, shuts down without closing the browser, then exits — in that order", async () => {
    const order: string[] = [];
    await expect(abortAndExit(makeEngine(order), 130, fakeExit(order))).rejects.toBeInstanceOf(
      ExitSignal,
    );
    expect(order).toEqual(["abort", "shutdown:false", "exit:130"]);
  });

  it("still shuts down and exits when abort rejects", async () => {
    const order: string[] = [];
    await expect(
      abortAndExit(makeEngine(order, { stopRejects: true }), 143, fakeExit(order)),
    ).rejects.toBeInstanceOf(ExitSignal);
    expect(order).toEqual(["abort", "shutdown:false", "exit:143"]);
  });
});
