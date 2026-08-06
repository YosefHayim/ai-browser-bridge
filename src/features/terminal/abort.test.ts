import { describe, expect, it } from "vitest";
import { abortAndExit } from "./cliOperations.ts";

// Thrown by the fake exit so assertions can observe process.exit without ending the test process.
class ExitSignal extends Error {
  constructor(readonly code: number) {
    super(`exit(${code})`);
  }
}

type FakeEngine = Parameters<typeof abortAndExit>[0];

const recordingEngine = (order: string[], options: { stopRejects?: boolean } = {}): FakeEngine => {
  return {
    getOrchestrator: () => ({
      stopResponse: async () => {
        order.push("abort");
        if (options.stopRejects) throw new Error("abort failed");
        return true;
      },
    }),
    shutdown: async (opts?: { closeBrowser?: boolean }) => {
      const closeBrowser =
        opts === undefined || opts.closeBrowser === undefined ? false : opts.closeBrowser;
      order.push(`shutdown:${closeBrowser}`);
    },
  } as unknown as FakeEngine;
};

// `(code: number) => never` that throws so the test process keeps running.
const fakeExit =
  (order: string[]): ((code: number) => never) =>
  (code) => {
    order.push(`exit:${code}`);
    throw new ExitSignal(code);
  };

describe("abortAndExit", () => {
  it("aborts, shuts down without closing the browser, then exits — in that order", async () => {
    const order: string[] = [];
    await expect(abortAndExit(recordingEngine(order), 130, fakeExit(order))).rejects.toBeInstanceOf(
      ExitSignal,
    );
    expect(order).toEqual(["abort", "shutdown:false", "exit:130"]);
  });

  it("still shuts down and exits when abort rejects", async () => {
    const order: string[] = [];
    await expect(
      abortAndExit(recordingEngine(order, { stopRejects: true }), 143, fakeExit(order)),
    ).rejects.toBeInstanceOf(ExitSignal);
    expect(order).toEqual(["abort", "shutdown:false", "exit:143"]);
  });
});
