import { describe, expect, it } from "vitest";
import { abortAndExit } from "../presentation/commandSession.ts";

type FakeEngine = Parameters<typeof abortAndExit>[0];

// Thrown by the fake exit so assertions can observe process.exit without ending the test process.
class ExitSignal extends Error {
  constructor(readonly code: number) {
    super(`exit(${code})`);
  }
}

const recordingEngine = (order: string[], options: { stopRejects?: boolean } = {}): FakeEngine => {
  return {
    getBrowserConversation: () => ({
      stopResponse: async () => {
        order.push("abort");
        if (options.stopRejects) throw new Error("abort failed");
        return true;
      },
    }),
    shutdown: async (shutdownOptions?: { closeBrowser?: boolean }) => {
      const closeBrowser =
        shutdownOptions === undefined || shutdownOptions.closeBrowser === undefined
          ? false
          : shutdownOptions.closeBrowser;
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
