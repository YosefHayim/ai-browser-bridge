import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Page } from "playwright";
import { describe, expect, it, vi } from "vitest";
import type { BrowserMcpOperations } from "../browserMcpServer.ts";
import {
  type ChatgptMcpTool,
  handleChatgptMcpCall,
  registerChatgptMcpTools,
} from "./chatgptMcpTools.ts";

const fanOut: BrowserMcpOperations["fanOut"] = async () => ({}) as never;

// Seam is generic (`<T>`); cast concrete mocks at the deps boundary so call assertions keep a real mock ref.
const asChatGptPageSeam = (mock: unknown): BrowserMcpOperations["withChatGptPage"] =>
  mock as BrowserMcpOperations["withChatGptPage"];

const rawRenderState = (overrides: Record<string, unknown> = {}) => ({
  streaming: false,
  assistantTurnCount: 1,
  images: { loaded: 0, pending: 0, total: 0 },
  lastAssistantText: "",
  noticeCandidates: [],
  ...overrides,
});

describe("handleChatgptMcpCall", () => {
  it("reads the active-tab render state through the withChatGptPage seam", async () => {
    const page = {
      evaluate: async () =>
        rawRenderState({ streaming: true, images: { loaded: 1, pending: 1, total: 2 } }),
    } as unknown as Page;
    const withChatGptPage = vi.fn((pageOperation: (page: Page) => Promise<unknown>) =>
      pageOperation(page),
    );

    const toolReply = await handleChatgptMcpCall(
      { repoRoot: "/repo", fanOut, withChatGptPage: asChatGptPageSeam(withChatGptPage) },
      "chatgpt_render_state",
      {},
    );

    expect(toolReply.ok).toBe(true);
    expect(JSON.parse(toolReply.output)).toMatchObject({
      streaming: true,
      images: { loaded: 1, pending: 1, total: 2 },
    });
    expect(withChatGptPage).toHaveBeenCalledOnce();
  });

  it("sweeps only the chatgpt.com tabs when allTabs:true", async () => {
    const pageAtUrl = (url: string) => ({
      url: () => url,
      evaluate: async () => rawRenderState(),
    });
    const page = {
      context: () => ({
        pages: () => [pageAtUrl("https://chatgpt.com/c/a"), pageAtUrl("https://x.test/y")],
      }),
    } as unknown as Page;
    const withChatGptPage = vi.fn((pageOperation: (page: Page) => Promise<unknown>) =>
      pageOperation(page),
    );

    const toolReply = await handleChatgptMcpCall(
      { repoRoot: "/repo", fanOut, withChatGptPage: asChatGptPageSeam(withChatGptPage) },
      "chatgpt_render_state",
      { allTabs: true },
    );

    expect(toolReply.ok).toBe(true);
    const tabs = JSON.parse(toolReply.output) as Array<{ url: string }>;
    expect(tabs).toHaveLength(1);
    const firstTab = tabs[0];
    if (firstTab === undefined) throw new Error("expected one ChatGPT tab");
    expect(firstTab.url).toBe("https://chatgpt.com/c/a");
  });

  it("reports ok:false when no ChatGPT session is wired", async () => {
    const toolReply = await handleChatgptMcpCall(
      { repoRoot: "/repo", fanOut },
      "chatgpt_render_state",
      {},
    );
    expect(toolReply.ok).toBe(false);
    expect(toolReply.output).toContain("not available");
  });
});

describe("registerChatgptMcpTools", () => {
  it("registers the chatgpt_render_state tool with a callable handler", async () => {
    const mcp = new McpServer({ name: "test", version: "0.0.0" });
    registerChatgptMcpTools(mcp, { repoRoot: "/repo", fanOut } satisfies BrowserMcpOperations);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0.0.0" });
    await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const listedTools = await client.listTools();
      expect(listedTools.tools.map((tool) => tool.name)).toEqual<ChatgptMcpTool[]>([
        "chatgpt_render_state",
      ]);
    } finally {
      await client.close();
      await mcp.close();
    }
  });
});
