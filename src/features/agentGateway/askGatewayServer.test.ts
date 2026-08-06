import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import type { FanoutResult } from "@/features/bridge";
import {
  type AskGatewayDeps,
  createAskGatewayServer,
  handleAskGatewayCall,
  handleConversationSearchGatewayCall,
} from "./askGatewayServer.ts";

const fakeFanoutResult: FanoutResult = {
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
  it("builds one task per provider and returns the fan-out result as JSON", async () => {
    const fanOut = vi.fn(async () => fakeFanoutResult);
    const reply = await handleAskGatewayCall(
      { repoRoot: "/repo", fanOut },
      { prompt: "hello", providers: "chatgpt,gemini", timeoutSeconds: 30 },
    );
    expect(reply.ok).toBe(true);
    expect(JSON.parse(reply.output)).toEqual(fakeFanoutResult);
    expect(fanOut).toHaveBeenCalledWith(
      [
        { prompt: "hello", provider: "chatgpt" },
        { prompt: "hello", provider: "gemini" },
      ],
      { timeoutMs: 30_000 },
    );
  });

  it("defaults the provider and passes no options when omitted", async () => {
    const fanOut = vi.fn(async () => fakeFanoutResult);
    await handleAskGatewayCall({ repoRoot: "/repo", fanOut }, { prompt: "hi" });
    expect(fanOut).toHaveBeenCalledWith([{ prompt: "hi", provider: "chatgpt" }], {});
  });

  it("uses an explicit tasks array, overriding prompt/providers, and threads pagination", async () => {
    const fanOut = vi.fn(async () => fakeFanoutResult);
    await handleAskGatewayCall(
      { repoRoot: "/repo", fanOut },
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
    expect(fanOut).toHaveBeenCalledWith(
      [
        { prompt: "a", label: "x" },
        { prompt: "b", isolate: "work" },
      ],
      { maxConcurrency: 2, limit: 5, offset: 3, maxReplyChars: 500 },
    );
  });

  it("reports an unknown provider as ok:false without calling the core", async () => {
    const fanOut = vi.fn(async () => fakeFanoutResult);
    const reply = await handleAskGatewayCall(
      { repoRoot: "/repo", fanOut },
      { prompt: "hi", providers: "chatgpt,bogus" },
    );
    expect(reply.ok).toBe(false);
    expect(reply.output).toMatch(/Unknown provider "bogus"/);
    expect(fanOut).not.toHaveBeenCalled();
  });

  it("reports a missing prompt/tasks as ok:false without calling the core", async () => {
    const fanOut = vi.fn(async () => fakeFanoutResult);
    const reply = await handleAskGatewayCall({ repoRoot: "/repo", fanOut }, {});
    expect(reply.ok).toBe(false);
    expect(reply.output).toMatch(/Provide `prompt`.*or a non-empty `tasks`/);
    expect(fanOut).not.toHaveBeenCalled();
  });
});

describe("handleConversationSearchGatewayCall", () => {
  it("resolves providers and returns search results as JSON", async () => {
    const searchHits = {
      chatgpt: { ok: true, results: [{ id: "c1", title: "Bridge", url: "url" }], elapsedMs: 4 },
    };
    const searchConversations = vi.fn(async () => searchHits);
    const reply = await handleConversationSearchGatewayCall(
      { repoRoot: "/repo", fanOut: vi.fn(async () => fakeFanoutResult), searchConversations },
      { query: "bridge", providers: "chatgpt", limit: 5 },
    );

    expect(reply.ok).toBe(true);
    expect(JSON.parse(reply.output)).toEqual(searchHits);
    expect(searchConversations).toHaveBeenCalledWith(["chatgpt"], "bridge", { limit: 5 });
  });

  it("reports missing search dependency as ok:false", async () => {
    const reply = await handleConversationSearchGatewayCall(
      { repoRoot: "/repo", fanOut: vi.fn(async () => fakeFanoutResult) },
      { query: "bridge" },
    );

    expect(reply.ok).toBe(false);
    expect(reply.output).toContain("not available");
  });
});

describe("createAskGatewayServer MCP registration", () => {
  const connect = async (deps: AskGatewayDeps) => {
    const server = createAskGatewayServer(deps);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return { client, server };
  };

  // Regression: SDK 1.29 reads `tool.handler`; passing `{}` as annotations to the
  // frozen positional `tool()` overload silently made the handler the empty object
  // ("typedHandler is not a function"). This drives the real registration end-to-end.
  it("registers a callable ask tool that returns the fan-out result", async () => {
    const fanOut = vi.fn(async () => fakeFanoutResult);
    const { client, server } = await connect({ repoRoot: "/repo", fanOut });
    try {
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toContain("ask");

      const toolReply = await client.callTool({
        name: "ask",
        arguments: { prompt: "hello", providers: "chatgpt" },
      });

      expect(toolReply.isError).toBeFalsy();
      const [first] = toolReply.content as Array<{ text: string; type: string }>;
      if (first === undefined) throw new Error("expected the ask tool to return text content");
      expect(JSON.parse(first.text)).toEqual(fakeFanoutResult);
      expect(fanOut).toHaveBeenCalledOnce();
    } finally {
      await client.close();
      await server.close();
    }
  });
});
