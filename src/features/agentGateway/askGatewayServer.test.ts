import type { FanoutBatchResult } from "@/features/bridge/fanoutOrchestrator.ts";
import { describe, expect, it, vi } from "vitest";
import { handleAskGatewayCall, handleConversationSearchGatewayCall } from "./askGatewayServer.ts";

const fakeResult: FanoutBatchResult = {
  total: 1,
  offset: 0,
  limit: 20,
  nextOffset: null,
  results: [
    {
      target: {
        provider: "chatgpt",
        mode: "new",
        id: "c1",
        url: "https://chatgpt.com/c/c1",
        isolate: null,
      },
      ok: true,
      reply: "hi",
      elapsedMs: 5,
    },
  ],
};

describe("handleAskGatewayCall", () => {
  it("builds one task per provider and returns the batch result as JSON", async () => {
    const runBatch = vi.fn(async () => fakeResult);
    const res = await handleAskGatewayCall(
      { runBatch },
      { prompt: "hello", providers: "chatgpt,gemini", timeoutSeconds: 30 },
    );
    expect(res.ok).toBe(true);
    expect(JSON.parse(res.output)).toEqual(fakeResult);
    expect(runBatch).toHaveBeenCalledWith(
      [
        { prompt: "hello", provider: "chatgpt" },
        { prompt: "hello", provider: "gemini" },
      ],
      { timeoutMs: 30_000 },
    );
  });

  it("defaults the provider and passes no options when omitted", async () => {
    const runBatch = vi.fn(async () => fakeResult);
    await handleAskGatewayCall({ runBatch }, { prompt: "hi" });
    expect(runBatch).toHaveBeenCalledWith([{ prompt: "hi", provider: "chatgpt" }], {});
  });

  it("uses an explicit tasks array, overriding prompt/providers, and threads pagination", async () => {
    const runBatch = vi.fn(async () => fakeResult);
    await handleAskGatewayCall(
      { runBatch },
      {
        prompt: "ignored",
        tasks: [
          { prompt: "a", label: "x" },
          { prompt: "b", isolate: "work" },
        ],
        maxConcurrency: 2,
        limit: 5,
        offset: 3,
        maxReplyChars: 500,
      },
    );
    expect(runBatch).toHaveBeenCalledWith(
      [
        { prompt: "a", label: "x" },
        { prompt: "b", isolate: "work" },
      ],
      { maxConcurrency: 2, limit: 5, offset: 3, maxReplyChars: 500 },
    );
  });

  it("reports an unknown provider as ok:false without calling the core", async () => {
    const runBatch = vi.fn(async () => fakeResult);
    const res = await handleAskGatewayCall(
      { runBatch },
      { prompt: "hi", providers: "chatgpt,bogus" },
    );
    expect(res.ok).toBe(false);
    expect(res.output).toMatch(/Unknown provider "bogus"/);
    expect(runBatch).not.toHaveBeenCalled();
  });

  it("reports a missing prompt/tasks as ok:false without calling the core", async () => {
    const runBatch = vi.fn(async () => fakeResult);
    const res = await handleAskGatewayCall({ runBatch }, {});
    expect(res.ok).toBe(false);
    expect(res.output).toMatch(/Provide `prompt`.*or a non-empty `tasks`/);
    expect(runBatch).not.toHaveBeenCalled();
  });
});

describe("handleConversationSearchGatewayCall", () => {
  it("resolves providers and returns search results as JSON", async () => {
    const results = {
      chatgpt: { ok: true, results: [{ id: "c1", title: "Bridge", url: "url" }], elapsedMs: 4 },
    };
    const searchConversations = vi.fn(async () => results);
    const res = await handleConversationSearchGatewayCall(
      { runBatch: vi.fn(async () => fakeResult), searchConversations },
      { query: "bridge", providers: "chatgpt", limit: 5 },
    );

    expect(res.ok).toBe(true);
    expect(JSON.parse(res.output)).toEqual(results);
    expect(searchConversations).toHaveBeenCalledWith(["chatgpt"], "bridge", { limit: 5 });
  });

  it("reports missing search dependency as ok:false", async () => {
    const res = await handleConversationSearchGatewayCall(
      { runBatch: vi.fn(async () => fakeResult) },
      { query: "bridge" },
    );

    expect(res.ok).toBe(false);
    expect(res.output).toContain("not available");
  });
});
