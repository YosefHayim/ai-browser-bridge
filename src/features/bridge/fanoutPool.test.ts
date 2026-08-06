import { describe, expect, it } from "vitest";
import type { FanoutTarget, FanoutTaskResult } from "./fanoutPool.ts";
import { fanoutFailed, runFanoutTasks } from "./fanoutPool.ts";

const TARGET: FanoutTarget = {
  provider: "chatgpt",
  mode: "new",
  id: "c1",
  url: "https://chatgpt.com/c/c1",
  isolate: null,
};

describe("runFanoutTasks", () => {
  it("returns one row per task in order, echoing labels and targets", async () => {
    const fanout = await runFanoutTasks(
      [{ prompt: "a", label: "first" }, { prompt: "b" }],
      async (task) => ({
        reply: `R-${task.prompt}`,
        target: { ...TARGET, id: `id-${task.prompt}`, url: `u-${task.prompt}` },
      }),
      { maxConcurrency: 2 },
    );
    expect(fanout.results[0]).toMatchObject({
      label: "first",
      ok: true,
      reply: "R-a",
      target: { id: "id-a" },
    });
    expect(fanout.results[1]).toMatchObject({ ok: true, reply: "R-b" });
    expect(fanout.results[1]?.label).toBeUndefined();
  });

  it("isolates a failing task without failing the rest", async () => {
    const fanout = await runFanoutTasks(
      [{ prompt: "a" }, { prompt: "b" }],
      async (task) => {
        if (task.prompt === "b") throw new Error("boom");
        return { reply: "ok", target: TARGET };
      },
      { maxConcurrency: 2 },
    );
    expect(fanout.results[0]).toMatchObject({ ok: true, reply: "ok" });
    expect(fanout.results[1]).toMatchObject({ ok: false, error: "boom", target: null });
  });

  it("never runs more than maxConcurrency tasks at once", async () => {
    let inFlight = 0;
    let peak = 0;
    const runOne = async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 15));
      inFlight -= 1;
      return { reply: "x", target: TARGET };
    };
    await runFanoutTasks(
      Array.from({ length: 6 }, (_, i) => ({ prompt: `p${i}` })),
      runOne,
      { maxConcurrency: 2 },
    );
    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBeGreaterThan(1);
  });

  it("truncates a long reply and flags the original length", async () => {
    const fanout = await runFanoutTasks(
      [{ prompt: "x" }],
      async () => ({ reply: "abcdefghij", target: TARGET }),
      { maxReplyChars: 4 },
    );
    expect(fanout.results[0]).toMatchObject({ reply: "abcd", truncated: true, replyChars: 10 });
  });

  it("windows tasks by offset/limit and reports total + nextOffset", async () => {
    const fanout = await runFanoutTasks(
      Array.from({ length: 5 }, (_, i) => ({ prompt: `p${i}` })),
      async (task) => ({ reply: `reply-${task.prompt}`, target: TARGET }),
      { limit: 2, offset: 1 },
    );
    expect(fanout.total).toBe(5);
    expect(fanout.offset).toBe(1);
    expect(fanout.limit).toBe(2);
    expect(fanout.results.map((row) => row.reply)).toEqual(["reply-p1", "reply-p2"]);
    expect(fanout.nextOffset).toBe(3);
  });

  it("reports nextOffset null once the last task is consumed", async () => {
    const fanout = await runFanoutTasks(
      Array.from({ length: 3 }, (_, i) => ({ prompt: `p${i}` })),
      async () => ({ reply: "x", target: TARGET }),
      { limit: 10 },
    );
    expect(fanout.nextOffset).toBeNull();
  });

  it("times out a slow task as a per-task error", async () => {
    const fanout = await runFanoutTasks([{ prompt: "x" }], () => new Promise<never>(() => {}), {
      timeoutMs: 10,
    });
    expect(fanout.results[0]?.ok).toBe(false);
    expect(fanout.results[0]?.error).toMatch(/timed out after 10ms/);
  });
});

describe("fanoutFailed", () => {
  const okRow: FanoutTaskResult = { target: TARGET, ok: true, elapsedMs: 1 };
  const failedRow: FanoutTaskResult = { target: null, ok: false, error: "x", elapsedMs: 1 };
  const fanoutWithRows = (taskRows: FanoutTaskResult[]) => ({
    total: taskRows.length,
    offset: 0,
    limit: 20,
    nextOffset: null,
    results: taskRows,
  });

  it("is true only when all tasks fail (non-strict)", () => {
    expect(fanoutFailed(fanoutWithRows([okRow, failedRow]), false)).toBe(false);
    expect(fanoutFailed(fanoutWithRows([failedRow, failedRow]), false)).toBe(true);
  });

  it("is true when any task fails (strict)", () => {
    expect(fanoutFailed(fanoutWithRows([okRow, failedRow]), true)).toBe(true);
    expect(fanoutFailed(fanoutWithRows([okRow, okRow]), true)).toBe(false);
  });

  it("treats zero tasks as failed", () => {
    expect(
      fanoutFailed({ total: 0, offset: 0, limit: 20, nextOffset: null, results: [] }, false),
    ).toBe(true);
  });

  it("treats an empty window past the end as not failed", () => {
    expect(
      fanoutFailed({ total: 3, offset: 5, limit: 20, nextOffset: null, results: [] }, false),
    ).toBe(false);
  });
});
