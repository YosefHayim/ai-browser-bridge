import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Page } from "playwright";
import { describe, expect, it, vi } from "vitest";
import { type DesignRpcCall, fakeDesignPage } from "@/testSupport/fakeDesignPage.ts";
import type { AskGatewayDeps } from "./askGatewayServer.ts";
import { DESIGN_GATEWAY_TOOLS, handleDesignGatewayCall } from "./designGatewayTools.ts";
import { connectGatewayClient, unusedFanOut } from "./gatewayTestClient.ts";

type StoredProject = {
  name: string;
  favorite: boolean;
  designSystemIds: string[];
  files: Map<string, string>;
};

type ServiceRequest = {
  projectId: string;
  name?: string;
  favorite?: boolean;
  designSystems?: Array<{ dsProjectId: string }>;
  files?: Array<{ path: string; data: string }>;
};

const savedConversations = {
  viewState: { activeChatId: "c1" },
  chats: {
    c1: {
      id: "c1",
      title: "Landing page",
      messages: [
        { id: "m1", role: "user", content: "Make a landing page" },
        { id: "m2", role: "assistant", kind: "chat-summary", content: "Built index.html." },
      ],
    },
  },
};

// The Claude Design service as the tab sees it, kept in memory.
const designServiceWith =
  (projects: Map<string, StoredProject>) =>
  (call: DesignRpcCall): unknown => {
    const request = call.body as ServiceRequest;
    const project = projects.get(request.projectId);
    switch (call.method) {
      case "ListProjects":
        return {
          items: [...projects.entries()].map(([projectId, stored]) => ({
            projectId,
            name: stored.name,
            isFavorite: stored.favorite,
          })),
        };
      case "GetProject":
        return {
          projectId: request.projectId,
          name: project?.name,
          designSystems: project?.designSystemIds.map((dsProjectId) => ({ dsProjectId })),
        };
      case "WriteFiles":
        for (const file of request.files ?? []) project?.files.set(file.path, file.data);
        return { files: request.files?.map((file) => ({ path: file.path, version: "1" })) };
      case "ListFiles":
        return {
          entries: [...(project?.files.keys() ?? [])].map((path) => ({ path, type: "file" })),
          total: project?.files.size,
        };
      case "GetProjectData":
        return { data: Buffer.from(JSON.stringify(savedConversations)).toString("base64") };
      case "UpdateProject":
        if (project !== undefined && request.name !== undefined) project.name = request.name;
        return {};
      case "SetProjectFavorite":
        if (project !== undefined) project.favorite = request.favorite === true;
        return {};
      case "UpdateProjectDesignSystems":
        if (project !== undefined) {
          project.designSystemIds = (request.designSystems ?? []).map((ref) => ref.dsProjectId);
        }
        return { designSystems: request.designSystems };
      case "DeleteProject":
        projects.delete(request.projectId);
        return {};
      default:
        throw new Error(`the in-memory service has no ${call.method}`);
    }
  };

const toolJson = (toolCall: Awaited<ReturnType<Client["callTool"]>>): unknown => {
  const [firstContent] = toolCall.content as Array<{ text: string }>;
  if (firstContent === undefined) throw new Error("expected text content");
  return JSON.parse(firstContent.text);
};

describe("design_* tools over MCP", () => {
  it("lists, uploads, reads, updates, and deletes a project end to end", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "bridge-design-gateway-"));
    await writeFile(join(repoRoot, "logo.svg"), "<svg/>");
    const projects = new Map<string, StoredProject>([
      ["p1", { name: "Launch", favorite: false, designSystemIds: [], files: new Map() }],
    ]);
    const { page } = fakeDesignPage({ answerRpc: designServiceWith(projects) });
    const runOnPage = (runPage: (designPage: Page) => Promise<unknown>) => runPage(page);
    const { client, mcpServer } = await connectGatewayClient({
      repoRoot,
      fanOut: unusedFanOut,
      withDesignPage: runOnPage as AskGatewayDeps["withDesignPage"],
    });
    const callTool = (name: string, args: Record<string, unknown>) =>
      client.callTool({ name, arguments: args });
    try {
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining([...DESIGN_GATEWAY_TOOLS]),
      );

      expect(toolJson(await callTool("design_list_projects", {}))).toMatchObject([
        { id: "p1", name: "Launch", url: "https://claude.ai/design/p/p1" },
      ]);

      const put = await callTool("design_put_files", {
        projectId: "p1",
        files: [{ localPath: "logo.svg", path: "assets/logo.svg" }],
      });
      expect(put.isError).toBeFalsy();
      expect(projects.get("p1")?.files.get("assets/logo.svg")).toBe(
        Buffer.from("<svg/>").toString("base64"),
      );
      expect(toolJson(await callTool("design_list_files", { projectId: "p1" }))).toMatchObject([
        { path: "assets/logo.svg", kind: "file" },
      ]);

      expect(
        toolJson(await callTool("design_read_conversation", { projectId: "p1" })),
      ).toMatchObject({
        conversations: [{ id: "c1", title: "Landing page", active: true }],
        messages: [
          { role: "user", content: "Make a landing page" },
          { role: "assistant", content: "Built index.html." },
        ],
      });

      const updated = await callTool("design_update_project", {
        projectId: "p1",
        name: "Launch v2",
        favorite: true,
        designSystemIds: ["ds1"],
      });
      expect(toolJson(updated)).toMatchObject({ name: "Launch v2", designSystemIds: ["ds1"] });
      expect(projects.get("p1")?.favorite).toBe(true);

      const unconfirmed = await callTool("design_delete_project", { projectId: "p1" });
      expect(unconfirmed.isError).toBe(true);
      expect(projects.has("p1")).toBe(true);
      await callTool("design_delete_project", { projectId: "p1", confirm: true });
      expect(toolJson(await callTool("design_list_projects", {}))).toEqual([]);
    } finally {
      await client.close();
      await mcpServer.close();
    }
  });

  it("refuses a local file outside the repo before touching the browser", async () => {
    const withDesignPage = vi.fn();
    const gatewayReply = await handleDesignGatewayCall(
      {
        repoRoot: "/repo",
        fanOut: unusedFanOut,
        withDesignPage: withDesignPage as AskGatewayDeps["withDesignPage"],
      },
      "design_put_files",
      { projectId: "p1", files: [{ localPath: "../secrets.txt" }] },
    );

    expect(gatewayReply).toEqual({ ok: false, output: "Path escapes repo root: ../secrets.txt" });
    expect(withDesignPage).not.toHaveBeenCalled();
  });

  it("reports ok:false when no Claude Design session is wired", async () => {
    const gatewayReply = await handleDesignGatewayCall(
      { repoRoot: "/repo", fanOut: unusedFanOut },
      "design_list_projects",
      {},
    );

    expect(gatewayReply.ok).toBe(false);
    expect(gatewayReply.output).toContain("not available");
  });
});
