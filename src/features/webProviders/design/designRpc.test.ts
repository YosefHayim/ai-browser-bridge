import { describe, expect, it } from "vitest";
import { fakeDesignPage } from "@/testSupport/fakeDesignPage.ts";
import { callDesignRpc, ListProjectsReplySchema, projectIdFromDesignUrl } from "./designRpc.ts";

describe("callDesignRpc", () => {
  it("sends the method, body, and organization from the tab and decodes the reply once", async () => {
    const { page, calls } = fakeDesignPage({
      answerRpc: () => ({ items: [{ projectId: "p1", name: "Deck" }] }),
    });

    const reply = await callDesignRpc({
      page,
      method: "ListProjects",
      body: { cursor: "" },
      replySchema: ListProjectsReplySchema,
    });

    expect(calls).toEqual([
      { method: "ListProjects", body: { cursor: "" }, organizationUuid: "org-1" },
    ]);
    expect(reply.items).toEqual([{ projectId: "p1", name: "Deck" }]);
    expect(reply.cursor).toBe("");
  });

  it("reports a Connect error with the method name", async () => {
    const { page } = fakeDesignPage({
      status: 404,
      answerRpc: () => ({ code: "not_found", message: "project not found" }),
    });

    await expect(
      callDesignRpc({ page, method: "GetProject", body: {}, replySchema: ListProjectsReplySchema }),
    ).rejects.toThrow("Claude Design GetProject failed (404): project not found");
  });

  it("asks for sign-in when the session is gone", async () => {
    const { page } = fakeDesignPage({ status: 401, answerRpc: () => "<html>Log in</html>" });

    await expect(
      callDesignRpc({ page, method: "GetMe", body: {}, replySchema: ListProjectsReplySchema }),
    ).rejects.toThrow(/sign in at claude\.ai/);
  });

  it("reports invalid successful replies without losing the method name", async () => {
    const { page } = fakeDesignPage({ answerRpc: () => ({ items: [{ name: "Missing ID" }] }) });
    const projectRequest = callDesignRpc({
      page,
      method: "ListProjects",
      body: {},
      replySchema: ListProjectsReplySchema,
    });
    await expect(projectRequest).rejects.toThrow(
      "Claude Design ListProjects: unexpected reply shape",
    );
  });

  it("preserves plain error text when an error response is not Connect JSON", async () => {
    const { page } = fakeDesignPage({ status: 502, answerRpc: () => "Upstream unavailable" });
    const projectRequest = callDesignRpc({
      page,
      method: "ListProjects",
      body: {},
      replySchema: ListProjectsReplySchema,
    });
    await expect(projectRequest).rejects.toThrow("Upstream unavailable");
  });
});

describe("projectIdFromDesignUrl", () => {
  it("reads the project id from a project URL only", () => {
    expect(projectIdFromDesignUrl("https://claude.ai/design/p/abc-123?file=a.html")).toBe(
      "abc-123",
    );
    expect(projectIdFromDesignUrl("https://claude.ai/design")).toBeUndefined();
  });

  it("ignores other sites and malformed ids", () => {
    expect(projectIdFromDesignUrl("https://example.com/design/p/abc-123")).toBeUndefined();
    expect(projectIdFromDesignUrl("https://claude.ai/design/p/%zz")).toBeUndefined();
  });
});
