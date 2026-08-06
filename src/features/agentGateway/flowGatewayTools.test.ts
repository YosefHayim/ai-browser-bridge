import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Page } from "playwright";
import { describe, expect, it, vi } from "vitest";
import type { AskGatewayDeps } from "./askGatewayServer.ts";
import {
  FLOW_GATEWAY_TOOLS,
  handleFlowGatewayCall,
  registerFlowGatewayTools,
} from "./flowGatewayTools.ts";

const fanOut: AskGatewayDeps["fanOut"] = async () => ({}) as never;

// Seam is generic (`<T>`); mocks are concrete — cast at the deps boundary only.
const asFlowPageSeam = (mock: unknown): AskGatewayDeps["withFlowPage"] =>
  mock as AskGatewayDeps["withFlowPage"];

describe("handleFlowGatewayCall", () => {
  it("runs a real verb through the withFlowPage seam and returns its JSON", async () => {
    // listClips maps video srcs → clip ids; feed a real media redirect shape.
    const page = {
      evaluate: async () => ["/fx/api/trpc/media.getMediaUrlRedirect?name=x"],
    } as unknown as Page;
    const withFlowPage = vi.fn((pageOp: (page: Page) => Promise<unknown>) => pageOp(page));

    const gatewayReply = await handleFlowGatewayCall(
      { repoRoot: "/repo", fanOut, withFlowPage: asFlowPageSeam(withFlowPage) },
      "flow_list_clips",
      {},
    );

    expect(gatewayReply.ok).toBe(true);
    expect(JSON.parse(gatewayReply.output)).toEqual([
      {
        id: "x",
        url: "https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=x",
        index: 0,
      },
    ]);
  });

  it("gates flow_delete_clip behind confirm:true without touching the browser", async () => {
    const withFlowPage = vi.fn(async () => ({}));
    const gatewayReply = await handleFlowGatewayCall(
      { repoRoot: "/repo", fanOut, withFlowPage: asFlowPageSeam(withFlowPage) },
      "flow_delete_clip",
      { clipId: "abc" },
    );

    expect(gatewayReply.ok).toBe(false);
    expect(gatewayReply.output).toMatch(/confirm:true/);
    expect(withFlowPage).not.toHaveBeenCalled();
  });

  it("runs flow_delete_clip once confirm:true is passed", async () => {
    const withFlowPage = vi.fn(async () => ({ id: "abc", movedToTrash: true }));
    const gatewayReply = await handleFlowGatewayCall(
      { repoRoot: "/repo", fanOut, withFlowPage: asFlowPageSeam(withFlowPage) },
      "flow_delete_clip",
      { clipId: "abc", confirm: true },
    );

    expect(gatewayReply.ok).toBe(true);
    expect(withFlowPage).toHaveBeenCalledOnce();
  });

  it("gates flow_delete_project behind confirm:true without touching the browser", async () => {
    const withFlowPage = vi.fn(async () => ({}));
    const gatewayReply = await handleFlowGatewayCall(
      { repoRoot: "/repo", fanOut, withFlowPage: asFlowPageSeam(withFlowPage) },
      "flow_delete_project",
      {},
    );

    expect(gatewayReply.ok).toBe(false);
    expect(gatewayReply.output).toMatch(/confirm:true/);
    expect(withFlowPage).not.toHaveBeenCalled();
  });

  it("requires a non-empty name for flow_rename_clip", async () => {
    const withFlowPage = vi.fn(async () => ({}));
    const gatewayReply = await handleFlowGatewayCall(
      { repoRoot: "/repo", fanOut, withFlowPage: asFlowPageSeam(withFlowPage) },
      "flow_rename_clip",
      { clipId: "abc", name: "  " },
    );

    expect(gatewayReply.ok).toBe(false);
    expect(gatewayReply.output).toMatch(/non-empty name/);
    expect(withFlowPage).not.toHaveBeenCalled();
  });

  it("requires startFramePath and a non-empty prompt for flow_generate", async () => {
    const withFlowPage = vi.fn(async () => ({}));
    const deps = { repoRoot: "/repo", fanOut, withFlowPage: asFlowPageSeam(withFlowPage) };

    const missingFrame = await handleFlowGatewayCall(deps, "flow_generate", {
      prompt: "pan left",
    });
    expect(missingFrame.ok).toBe(false);
    expect(missingFrame.output).toMatch(/startFramePath/);
    expect(withFlowPage).not.toHaveBeenCalled();

    const missingPrompt = await handleFlowGatewayCall(deps, "flow_generate", {
      startFramePath: "/tmp/frame.png",
      prompt: "  ",
    });
    expect(missingPrompt.ok).toBe(false);
    expect(missingPrompt.output).toMatch(/non-empty prompt/);
    expect(withFlowPage).not.toHaveBeenCalled();
  });

  it("requires an ingredientId for flow_remove_ingredient", async () => {
    const withFlowPage = vi.fn(async () => ({}));
    const gatewayReply = await handleFlowGatewayCall(
      { repoRoot: "/repo", fanOut, withFlowPage: asFlowPageSeam(withFlowPage) },
      "flow_remove_ingredient",
      { ingredientId: "" },
    );

    expect(gatewayReply.ok).toBe(false);
    expect(gatewayReply.output).toMatch(/ingredientId/);
    expect(withFlowPage).not.toHaveBeenCalled();
  });

  it("reports ok:false when the Flow page op throws", async () => {
    const withFlowPage = vi.fn(async () => {
      throw new Error("DOM changed");
    });
    const gatewayReply = await handleFlowGatewayCall(
      { repoRoot: "/repo", fanOut, withFlowPage: asFlowPageSeam(withFlowPage) },
      "flow_list_clips",
      {},
    );

    expect(gatewayReply.ok).toBe(false);
    expect(gatewayReply.output).toBe("DOM changed");
  });

  it("reports ok:false when no Flow session is wired", async () => {
    const gatewayReply = await handleFlowGatewayCall(
      { repoRoot: "/repo", fanOut },
      "flow_list_clips",
      {},
    );
    expect(gatewayReply.ok).toBe(false);
    expect(gatewayReply.output).toContain("not available");
  });
});

describe("registerFlowGatewayTools", () => {
  it("registers every flow_* tool with a callable handler", async () => {
    const mcp = new McpServer({ name: "test", version: "0.0.0" });
    registerFlowGatewayTools(mcp, { repoRoot: "/repo", fanOut } satisfies AskGatewayDeps);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0.0.0" });
    await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const listedTools = await client.listTools();
      expect(listedTools.tools.map((tool) => tool.name).sort()).toEqual(
        [...FLOW_GATEWAY_TOOLS].sort(),
      );
    } finally {
      await client.close();
      await mcp.close();
    }
  });
});
