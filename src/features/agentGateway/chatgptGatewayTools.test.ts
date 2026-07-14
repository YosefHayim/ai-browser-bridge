import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Page } from "playwright";
import { describe, expect, it, vi } from "vitest";
import type { AskGatewayDeps } from "./askGatewayServer.ts";
import {
  type ChatgptGatewayTool,
  handleChatgptGatewayCall,
  registerChatgptGatewayTools,
} from "./chatgptGatewayTools.ts";

const runBatch: AskGatewayDeps["runBatch"] = async () => ({}) as never;

// The seam is generic (`<T>`); mocks are concrete, so cast at the deps boundary while
// keeping the mock reference for call assertions.
const asSeam = (mock: unknown): AskGatewayDeps["withChatGptPage"] =>
  mock as AskGatewayDeps["withChatGptPage"];

/** A raw render-state snapshot as the in-page evaluate would return it. */
const rawSnapshot = (over: Record<string, unknown> = {}) => ({
  streaming: false,
  assistantTurnCount: 1,
  images: { loaded: 0, pending: 0, total: 0 },
  lastAssistantText: "",
  noticeCandidates: [],
  ...over,
});

describe("handleChatgptGatewayCall", () => {
  it("reads the active-tab render state through the withChatGptPage seam", async () => {
    // The seam runs the op against a fake page; readChatGptRenderState evaluates the snapshot.
    const page = {
      evaluate: async () =>
        rawSnapshot({ streaming: true, images: { loaded: 1, pending: 1, total: 2 } }),
    } as unknown as Page;
    const withChatGptPage = vi.fn((op: (p: Page) => Promise<unknown>) => op(page));

    const res = await handleChatgptGatewayCall(
      { runBatch, withChatGptPage: asSeam(withChatGptPage) },
      "chatgpt_render_state",
      {},
    );

    expect(res.ok).toBe(true);
    expect(JSON.parse(res.output)).toMatchObject({
      streaming: true,
      images: { loaded: 1, pending: 1, total: 2 },
    });
    expect(withChatGptPage).toHaveBeenCalledOnce();
  });

  it("sweeps only the chatgpt.com tabs when allTabs:true", async () => {
    const makeTab = (url: string) => ({ url: () => url, evaluate: async () => rawSnapshot() });
    const page = {
      context: () => ({
        pages: () => [makeTab("https://chatgpt.com/c/a"), makeTab("https://x.test/y")],
      }),
    } as unknown as Page;
    const withChatGptPage = vi.fn((op: (p: Page) => Promise<unknown>) => op(page));

    const res = await handleChatgptGatewayCall(
      { runBatch, withChatGptPage: asSeam(withChatGptPage) },
      "chatgpt_render_state",
      { allTabs: true },
    );

    expect(res.ok).toBe(true);
    const parsed = JSON.parse(res.output) as Array<{ url: string }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.url).toBe("https://chatgpt.com/c/a");
  });

  it("reports ok:false when no ChatGPT session is wired", async () => {
    const res = await handleChatgptGatewayCall({ runBatch }, "chatgpt_render_state", {});
    expect(res.ok).toBe(false);
    expect(res.output).toContain("not available");
  });
});

describe("registerChatgptGatewayTools", () => {
  it("registers the chatgpt_render_state tool", () => {
    const names: string[] = [];
    const mcp = {
      tool: (name: string) => {
        names.push(name);
      },
    } as unknown as McpServer;

    registerChatgptGatewayTools(mcp, { runBatch } satisfies AskGatewayDeps);

    expect(names).toEqual<ChatgptGatewayTool[]>(["chatgpt_render_state"]);
  });
});
