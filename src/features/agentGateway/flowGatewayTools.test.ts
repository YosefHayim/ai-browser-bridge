import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Page } from "playwright";
import { describe, expect, it, vi } from "vitest";
import type { AskGatewayDeps } from "./askGatewayServer.ts";
import {
  type FlowGatewayTool,
  handleFlowGatewayCall,
  registerFlowGatewayTools,
} from "./flowGatewayTools.ts";

const runBatch: AskGatewayDeps["runBatch"] = async () => ({}) as never;

// The seam is generic (`<T>`); mocks are concrete, so cast at the deps boundary while
// keeping the mock reference for call assertions.
const asSeam = (mock: unknown): AskGatewayDeps["withFlowPage"] =>
  mock as AskGatewayDeps["withFlowPage"];

describe("handleFlowGatewayCall", () => {
  it("runs a real verb through the withFlowPage seam and returns its JSON", async () => {
    // The seam runs the op against a fake page; listClips maps video srcs → clip ids.
    const page = {
      evaluate: async () => ["/fx/api/trpc/media.getMediaUrlRedirect?name=x"],
    } as unknown as Page;
    const withFlowPage = vi.fn((op: (p: Page) => Promise<unknown>) => op(page));

    const res = await handleFlowGatewayCall(
      { runBatch, withFlowPage: asSeam(withFlowPage) },
      "flow_list_clips",
      {},
    );

    expect(res.ok).toBe(true);
    expect(JSON.parse(res.output)).toEqual([
      {
        id: "x",
        url: "https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=x",
        index: 0,
      },
    ]);
  });

  it("gates flow_delete_clip behind confirm:true without touching the browser", async () => {
    const withFlowPage = vi.fn(async () => ({}));
    const res = await handleFlowGatewayCall(
      { runBatch, withFlowPage: asSeam(withFlowPage) },
      "flow_delete_clip",
      { clipId: "abc" },
    );

    expect(res.ok).toBe(false);
    expect(res.output).toMatch(/confirm:true/);
    expect(withFlowPage).not.toHaveBeenCalled();
  });

  it("runs flow_delete_clip once confirm:true is passed", async () => {
    const withFlowPage = vi.fn(async () => ({ id: "abc", movedToTrash: true }));
    const res = await handleFlowGatewayCall(
      { runBatch, withFlowPage: asSeam(withFlowPage) },
      "flow_delete_clip",
      { clipId: "abc", confirm: true },
    );

    expect(res.ok).toBe(true);
    expect(withFlowPage).toHaveBeenCalledOnce();
  });

  it("requires a non-empty name for flow_rename_clip", async () => {
    const withFlowPage = vi.fn(async () => ({}));
    const res = await handleFlowGatewayCall(
      { runBatch, withFlowPage: asSeam(withFlowPage) },
      "flow_rename_clip",
      { clipId: "abc", name: "  " },
    );

    expect(res.ok).toBe(false);
    expect(res.output).toMatch(/non-empty name/);
    expect(withFlowPage).not.toHaveBeenCalled();
  });

  it("reports ok:false when no Flow session is wired", async () => {
    const res = await handleFlowGatewayCall({ runBatch }, "flow_list_clips", {});
    expect(res.ok).toBe(false);
    expect(res.output).toContain("not available");
  });
});

describe("registerFlowGatewayTools", () => {
  it("registers every flow_* tool with a callable handler", async () => {
    const mcp = new McpServer({ name: "test", version: "0.0.0" });
    registerFlowGatewayTools(mcp, { runBatch } satisfies AskGatewayDeps);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0.0.0" });
    await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const listed = await client.listTools();
      const expected: FlowGatewayTool[] = [
        "flow_generate",
        "flow_list_clips",
        "flow_list_projects",
        "flow_download_clips",
        "flow_delete_clip",
        "flow_rename_clip",
        "flow_extend_clip",
        "flow_reuse_clip",
        "flow_rename_project",
        "flow_delete_project",
        "flow_list_ingredients",
        "flow_remove_ingredient",
        "flow_clear_ingredients",
      ];
      expect(listed.tools.map((tool) => tool.name).sort()).toEqual([...expected].sort());
    } finally {
      await client.close();
      await mcp.close();
    }
  });
});
