import type { FanoutResult } from "@/features/bridge/fanoutOrchestrator.ts";
import { describe, expect, it, vi } from "vitest";
import { handleAskGatewayCall, handleConversationSearchGatewayCall } from "./askGatewayServer.ts";

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

describe("handleConversationSearchGatewayCall", () => {
  it("resolves providers and returns search results as JSON", async () => {
    const results = {
      chatgpt: { ok: true, results: [{ id: "c1", title: "Bridge", url: "url" }], elapsedMs: 4 },
    };
    const searchConversations = vi.fn(async () => results);
    const res = await handleConversationSearchGatewayCall(
      { runFanout: vi.fn(async () => fakeResult), searchConversations },
      { query: "bridge", providers: "chatgpt", limit: 5 },
    );

    expect(res.ok).toBe(true);
    expect(JSON.parse(res.output)).toEqual(results);
    expect(searchConversations).toHaveBeenCalledWith(["chatgpt"], "bridge", { limit: 5 });
  });

  it("reports missing search dependency as ok:false", async () => {
    const res = await handleConversationSearchGatewayCall(
      { runFanout: vi.fn(async () => fakeResult) },
      { query: "bridge" },
    );

    expect(res.ok).toBe(false);
    expect(res.output).toContain("not available");
  });
});
