import { describe, expect, it } from "vitest";
import { stopEngine } from "./cli-operations.ts";

type FakeEngine = Parameters<typeof stopEngine>[0];

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

describe("stopEngine", () => {
  it("stops generation, then shuts down without closing the browser, in that order", async () => {
    const order: string[] = [];
    await stopEngine(recordingEngine(order));
    expect(order).toEqual(["abort", "shutdown:false"]);
  });

  it("still shuts down when stopping generation rejects", async () => {
    const order: string[] = [];
    await stopEngine(recordingEngine(order, { stopRejects: true }));
    expect(order).toEqual(["abort", "shutdown:false"]);
  });
});
