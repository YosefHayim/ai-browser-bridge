import { describe, expect, it } from "vitest";
import { addStopOnInterrupt, runUntilInterrupt } from "./user-interrupt.ts";

const waitOneTurn = async (): Promise<void> => {
  await new Promise((wakeUp) => setImmediate(wakeUp));
};

describe("runUntilInterrupt", () => {
  it("returns the command status and removes the signal listeners when the command ends first", async () => {
    const sigintListenersBefore = process.listenerCount("SIGINT");
    const sigtermListenersBefore = process.listenerCount("SIGTERM");

    const commandStatus = await runUntilInterrupt(async () => 0);

    expect(commandStatus).toBe(0);
    expect(process.listenerCount("SIGINT")).toBe(sigintListenersBefore);
    expect(process.listenerCount("SIGTERM")).toBe(sigtermListenersBefore);
  });

  it("runs the stop steps and returns 1 when SIGINT arrives during the command", async () => {
    const stopCalls: string[] = [];
    addStopOnInterrupt(async () => {
      stopCalls.push("stopped");
    });

    const commandStatus = await runUntilInterrupt(async () => {
      await waitOneTurn();
      process.emit("SIGINT", "SIGINT");
      await waitOneTurn();
      return 0;
    });

    expect(commandStatus).toBe(1);
    expect(stopCalls).toEqual(["stopped"]);
  });

  it("forgets the stop steps once the command ends, so a later signal does not run them", async () => {
    const stopCalls: string[] = [];
    await runUntilInterrupt(async () => {
      addStopOnInterrupt(async () => {
        stopCalls.push("stopped");
      });
      return 0;
    });

    await runUntilInterrupt(async () => {
      await waitOneTurn();
      process.emit("SIGTERM", "SIGTERM");
      await waitOneTurn();
      return 0;
    });

    expect(stopCalls).toEqual([]);
  });
});
