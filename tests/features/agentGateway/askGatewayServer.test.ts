import { describe, expect, it, vi } from "vitest";
import { handleAskGatewayCall } from "../../../src/features/agentGateway/askGatewayServer.ts";
import type { FanoutResult } from "../../../src/features/bridge/fanoutOrchestrator.ts";

const fakeResult: FanoutResult = {
  chatgpt: { ok: true, reply: "hi", elapsedMs: 5 },
  gemini: { ok: false, error: "nope", elapsedMs: 3 },
};

describe("handleAskGatewayCall", () => {
  it("resolves the provider list and returns the fan-out result as JSON", async () => {
    const runFanout = vi.fn(async () => fakeResult);
    const res = await handleAskGatewayCall(
      { runFanout },
      {
        prompt: "hello",
        providers: "chatgpt,gemini",
        timeoutSeconds: 30,
      },
    );
    expect(res.ok).toBe(true);
    expect(JSON.parse(res.output)).toEqual(fakeResult);
    expect(runFanout).toHaveBeenCalledWith(["chatgpt", "gemini"], "hello", { timeoutMs: 30_000 });
  });

  it("defaults the provider and timeout when omitted", async () => {
    const runFanout = vi.fn(async () => fakeResult);
    await handleAskGatewayCall({ runFanout }, { prompt: "hi" });
    expect(runFanout).toHaveBeenCalledWith(["chatgpt"], "hi", { timeoutMs: undefined });
  });

  it("reports an unknown provider as ok:false without calling the core", async () => {
    const runFanout = vi.fn(async () => fakeResult);
    const res = await handleAskGatewayCall(
      { runFanout },
      { prompt: "hi", providers: "chatgpt,bogus" },
    );
    expect(res.ok).toBe(false);
    expect(res.output).toMatch(/Unknown provider "bogus"/);
    expect(runFanout).not.toHaveBeenCalled();
  });
});
