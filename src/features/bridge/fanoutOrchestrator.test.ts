import { describe, expect, it } from "vitest";
import { fanoutAsk, fanoutFailed } from "./fanoutOrchestrator.ts";

describe("fanoutAsk", () => {
  it("captures every provider's reply, keyed by id", async () => {
    const result = await fanoutAsk(["chatgpt", "gemini"], async (p) => `reply from ${p}`);
    expect(result.chatgpt).toMatchObject({ ok: true, reply: "reply from chatgpt" });
    expect(result.gemini).toMatchObject({ ok: true, reply: "reply from gemini" });
    expect(typeof result.chatgpt?.elapsedMs).toBe("number");
  });

  it("isolates a failing provider without failing the others", async () => {
    const result = await fanoutAsk(["chatgpt", "gemini"], async (p) => {
      if (p === "gemini") throw new Error("boom");
      return "ok";
    });
    expect(result.chatgpt).toMatchObject({ ok: true, reply: "ok" });
    expect(result.gemini).toMatchObject({ ok: false, error: "boom" });
  });

  it("times out a slow provider as a per-provider error", async () => {
    const result = await fanoutAsk(
      ["chatgpt"],
      () => new Promise<string>(() => {}), // never resolves
      { timeoutMs: 10 },
    );
    expect(result.chatgpt?.ok).toBe(false);
    expect(result.chatgpt?.error).toMatch(/timed out after 10ms/);
  });
});

describe("fanoutFailed", () => {
  const ok = { ok: true, elapsedMs: 1 };
  const bad = { ok: false, elapsedMs: 1 };

  it("is true only when all fail (non-strict)", () => {
    expect(fanoutFailed({ a: ok, b: bad }, false)).toBe(false);
    expect(fanoutFailed({ a: bad, b: bad }, false)).toBe(true);
  });

  it("is true when any fails (strict)", () => {
    expect(fanoutFailed({ a: ok, b: bad }, true)).toBe(true);
    expect(fanoutFailed({ a: ok, b: ok }, true)).toBe(false);
  });

  it("treats an empty result as failed", () => {
    expect(fanoutFailed({}, false)).toBe(true);
  });
});
