import type { Page } from "playwright";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listChatGptProjects, readProjectIds } from "./chatgpt-projects-api.ts";

const SIDEBAR_PATH = "/backend-api/gizmos/snorlax/sidebar";

const createSidebarItem = (id: string, name: string) => ({ gizmo: { id, display: { name } } });

const createFakePage = (): Page => {
  return {
    evaluate: async (pageFunction: (argument: unknown) => Promise<unknown>, argument: unknown) =>
      pageFunction(argument),
  } as unknown as Page;
};

const stubSidebarApi = (replyForPath: (requestPath: string) => Response): string[] => {
  const requestedPaths: string[] = [];
  vi.stubGlobal("fetch", async (requestPath: string) => {
    const isSessionRequest = requestPath === "/api/auth/session";
    if (isSessionRequest) return Response.json({ accessToken: "test-access-token" });

    requestedPaths.push(requestPath);
    return replyForPath(requestPath);
  });
  return requestedPaths;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listChatGptProjects", () => {
  it("reads every sidebar page by its cursor until the last page", async () => {
    const requestedPaths = stubSidebarApi((requestPath) => {
      const isSecondPage = requestPath.includes("cursor=next-page");
      if (isSecondPage) {
        return Response.json({ items: [createSidebarItem("g-p-fixture-gamma", "Fixture Gamma")] });
      }

      return Response.json({
        items: [createSidebarItem("g-p-fixture-alpha", "Fixture Alpha")],
        cursor: "next-page",
      });
    });

    const projects = await listChatGptProjects(createFakePage());

    expect(projects).toEqual([
      { id: "g-p-fixture-alpha", name: "Fixture Alpha" },
      { id: "g-p-fixture-gamma", name: "Fixture Gamma" },
    ]);
    expect(requestedPaths).toEqual([SIDEBAR_PATH, `${SIDEBAR_PATH}?cursor=next-page`]);
  });

  it("throws the rate limit instead of returning a partial list", async () => {
    stubSidebarApi(() => new Response("{}", { status: 429 }));

    await expect(listChatGptProjects(createFakePage())).rejects.toThrow("HTTP 429");
  });
});

describe("readProjectIds", () => {
  it("returns the id of every planned Project name", async () => {
    stubSidebarApi(() =>
      Response.json({ items: [createSidebarItem("g-p-fixture-alpha", "Fixture Alpha")] }),
    );

    const projectIdByName = await readProjectIds(createFakePage(), ["Fixture Alpha"]);

    expect(projectIdByName.get("Fixture Alpha")).toBe("g-p-fixture-alpha");
  });

  it("throws with every missing Project name before any move", async () => {
    stubSidebarApi(() =>
      Response.json({ items: [createSidebarItem("g-p-fixture-alpha", "Fixture Alpha")] }),
    );

    await expect(
      readProjectIds(createFakePage(), ["Fixture Alpha", "Fixture Delta"]),
    ).rejects.toThrow('"Fixture Delta"');
  });
});
