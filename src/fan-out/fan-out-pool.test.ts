import { describe, expect, it } from "vitest";
import type { FanOutConversation, FanOutRow } from "@/fan-out/fan-out-pool.ts";
import { isFanOutFailed, runFanOutTasks } from "@/fan-out/fan-out-pool.ts";

const TARGET: FanOutConversation = {
  provider: "chatgpt",
  mode: "new",
  id: "c1",
  url: "https://chatgpt.com/c/c1",
  isolate: null,
};

describe("runFanOutTasks", () => {
  it("returns one row per task in order, echoing labels and targets", async () => {
    const fanOut = await runFanOutTasks(
      [{ prompt: "a", label: "first" }, { prompt: "b" }],
      async (task) => ({
        reply: `R-${task.prompt}`,
        target: { ...TARGET, id: `id-${task.prompt}`, url: `u-${task.prompt}` },
      }),
      { maxConcurrency: 2 },
    );
    expect(fanOut.taskReports[0]).toMatchObject({
      label: "first",
      ok: true,
      reply: "R-a",
      target: { id: "id-a" },
    });
    expect(fanOut.taskReports[1]).toMatchObject({ ok: true, reply: "R-b" });
    expect(fanOut.taskReports[1]?.label).toBeUndefined();
  });

  it("isolates a failing task without failing the rest", async () => {
    const fanOut = await runFanOutTasks(
      [{ prompt: "a" }, { prompt: "b" }],
      async (task) => {
        const isTaskPromptB = task.prompt === "b";
        if (isTaskPromptB) throw new Error("boom");

        return { reply: "ok", target: TARGET };
      },
      { maxConcurrency: 2 },
    );
    expect(fanOut.taskReports[0]).toMatchObject({ ok: true, reply: "ok" });
    expect(fanOut.taskReports[1]).toMatchObject({ ok: false, error: "boom", target: null });
  });

  it("never runs more than maxConcurrency tasks at once", async () => {
    let inFlight = 0;
    let peak = 0;
    async function runOne() {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((fulfill) => setTimeout(fulfill, 15));
      inFlight -= 1;
      return { reply: "x", target: TARGET };
    }
    await runFanOutTasks(
      Array.from({ length: 6 }, (_, i) => ({ prompt: `p${i}` })),
      runOne,
      { maxConcurrency: 2 },
    );
    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBeGreaterThan(1);
  });

  it("truncates a long reply and flags the original length", async () => {
    const fanOut = await runFanOutTasks(
      [{ prompt: "x" }],
      async () => ({ reply: "abcdefghij", target: TARGET }),
      { maxReplyChars: 4 },
    );
    expect(fanOut.taskReports[0]).toMatchObject({ reply: "abcd", truncated: true, replyChars: 10 });
  });

  it("windows tasks by offset/limit and reports total + nextOffset", async () => {
    const fanOut = await runFanOutTasks(
      Array.from({ length: 5 }, (_, i) => ({ prompt: `p${i}` })),
      async (task) => ({ reply: `reply-${task.prompt}`, target: TARGET }),
      { limit: 2, offset: 1 },
    );
    expect(fanOut.total).toBe(5);
    expect(fanOut.offset).toBe(1);
    expect(fanOut.limit).toBe(2);
    expect(fanOut.taskReports.map((stored) => stored.reply)).toEqual(["reply-p1", "reply-p2"]);
    expect(fanOut.nextOffset).toBe(3);
  });

  it("reports nextOffset null once the last task is consumed", async () => {
    const fanOut = await runFanOutTasks(
      Array.from({ length: 3 }, (_, i) => ({ prompt: `p${i}` })),
      async () => ({ reply: "x", target: TARGET }),
      { limit: 10 },
    );
    expect(fanOut.nextOffset).toBeNull();
  });

  it("times out a slow task as a per-task error", async () => {
    const fanOut = await runFanOutTasks([{ prompt: "x" }], () => new Promise<never>(() => {}), {
      timeoutMilliseconds: 10,
    });
    expect(fanOut.taskReports[0]?.ok).toBe(false);
    expect(fanOut.taskReports[0]?.error).toMatch(/timed out after 10ms/);
  });
});

describe("isFanOutFailed", () => {
  const storedOk: FanOutRow = { target: TARGET, ok: true, elapsedMs: 1 };
  const storedFailed: FanOutRow = { target: null, ok: false, error: "x", elapsedMs: 1 };
  function createFanOutWithStoredList(storedTaskList: FanOutRow[]) {
    return {
      total: storedTaskList.length,
      offset: 0,
      limit: 20,
      nextOffset: null,
      taskReports: storedTaskList,
    };
  }

  it("is true only when all tasks fail (non-strict)", () => {
    expect(isFanOutFailed(createFanOutWithStoredList([storedOk, storedFailed]), false)).toBe(false);
    expect(isFanOutFailed(createFanOutWithStoredList([storedFailed, storedFailed]), false)).toBe(
      true,
    );
  });

  it("is true when any task fails (strict)", () => {
    expect(isFanOutFailed(createFanOutWithStoredList([storedOk, storedFailed]), true)).toBe(true);
    expect(isFanOutFailed(createFanOutWithStoredList([storedOk, storedOk]), true)).toBe(false);
  });

  it("treats zero tasks as failed", () => {
    expect(
      isFanOutFailed({ total: 0, offset: 0, limit: 20, nextOffset: null, taskReports: [] }, false),
    ).toBe(true);
  });

  it("treats an empty window past the end as not failed", () => {
    expect(
      isFanOutFailed({ total: 3, offset: 5, limit: 20, nextOffset: null, taskReports: [] }, false),
    ).toBe(false);
  });
});
