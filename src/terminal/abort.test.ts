import { describe, expect, it } from "vitest";
import { stopEngine } from "./cli-operations.ts";

type FakeEngine = Parameters<typeof stopEngine>[0];

const createRecordingEngine = (
  order: string[],
  settings: { stopRejects?: boolean } = {},
): FakeEngine => {
  return {
    getOrchestrator: () => ({
      stopReply: async () => {
        order.push("abort");

        if (settings.stopRejects) throw new Error("abort failed");

        return true;
      },
    }),
    shutDown: async (settings?: { closeBrowser?: boolean }) => {
      const closeBrowser =
        settings == null || settings.closeBrowser == null ? false : settings.closeBrowser;
      order.push(`shutDown:${closeBrowser}`);
    },
  } as unknown as FakeEngine;
};

describe("stopEngine", () => {
  it("stops generation, then shuts down without closing the browser, in that order", async () => {
    const order: string[] = [];
    await stopEngine(createRecordingEngine(order));
    expect(order).toEqual(["abort", "shutDown:false"]);
  });

  it("still shuts down when stopping generation rejects", async () => {
    const order: string[] = [];
    await stopEngine(createRecordingEngine(order, { stopRejects: true }));
    expect(order).toEqual(["abort", "shutDown:false"]);
  });
});
