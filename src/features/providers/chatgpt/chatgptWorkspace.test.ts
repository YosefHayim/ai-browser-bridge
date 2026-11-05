import type { Page } from "playwright";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  moveChatToProject,
  projectNameFromDirectoryRowText,
  stripConversationId,
} from "./chatgptWorkspace.ts";

describe("stripConversationId", () => {
  it("extracts the id from a /c/<id> path", () => {
    expect(stripConversationId("/c/6a4231ee-02cc-83eb")).toBe("6a4231ee-02cc-83eb");
  });

  it("extracts the id from a full ChatGPT URL with query", () => {
    expect(stripConversationId("https://chatgpt.com/c/abc-123?model=gpt")).toBe("abc-123");
  });

  it("returns a bare id unchanged", () => {
    expect(stripConversationId("abc-123")).toBe("abc-123");
  });

  it("returns a non-id title unchanged so callers can match by title", () => {
    expect(stripConversationId("Cloudflare vs AWS")).toBe("Cloudflare vs AWS");
  });
});

describe("projectNameFromDirectoryRowText", () => {
  it("reads the project name from ChatGPT's current directory row", () => {
    expect(projectNameFromDirectoryRowText("Yoga App\n1w")).toBe("Yoga App");
  });

  it("ignores the Projects directory header", () => {
    expect(projectNameFromDirectoryRowText("Name\nModified")).toBeNull();
  });

  it("preserves a project named Name", () => {
    expect(projectNameFromDirectoryRowText("Name\nToday")).toBe("Name");
  });
});

const CHAT_ID = "6ac400c8-44a8-83ed-857f-6ff0df0052d6";
const PORTFOLIO_PROJECT_ID = "g-p-fixture-portfolio";

interface FakeConversationApi {
  conversationTemplateId: string | null;
  patchStatus: number;
  acceptsPatch: boolean;
  patchBodies: unknown[];
}

const fakePage = (): Page => {
  return {
    evaluate: async (pageFunction: (argument: unknown) => Promise<unknown>, argument: unknown) =>
      pageFunction(argument),
  } as unknown as Page;
};

const stubConversationApi = (api: FakeConversationApi): void => {
  vi.stubGlobal("fetch", async (requestPath: string, init?: RequestInit) => {
    const isSessionRequest = requestPath === "/api/auth/session";
    if (isSessionRequest) return Response.json({ accessToken: "test-access-token" });

    const isPatchRequest = init?.method === "PATCH";
    if (isPatchRequest) {
      const patchBody = JSON.parse(String(init?.body)) as { gizmo_id: string };
      api.patchBodies.push(patchBody);
      if (api.acceptsPatch) api.conversationTemplateId = patchBody.gizmo_id;
      return new Response("", { status: api.patchStatus });
    }
    return Response.json({ conversation_template_id: api.conversationTemplateId });
  });
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("moveChatToProject", () => {
  it("moves the chat with one PATCH and confirms it with a second read", async () => {
    const api: FakeConversationApi = {
      conversationTemplateId: null,
      patchStatus: 200,
      acceptsPatch: true,
      patchBodies: [],
    };
    stubConversationApi(api);

    const outcome = await moveChatToProject(fakePage(), {
      chat: CHAT_ID,
      project: "Portfolio",
      projectId: PORTFOLIO_PROJECT_ID,
    });

    expect(outcome.moved).toBe(true);
    expect(api.patchBodies).toEqual([{ gizmo_id: PORTFOLIO_PROJECT_ID }]);
  });

  it("reports alreadyFiled without a PATCH when the chat is already in the Project", async () => {
    const api: FakeConversationApi = {
      conversationTemplateId: PORTFOLIO_PROJECT_ID,
      patchStatus: 200,
      acceptsPatch: true,
      patchBodies: [],
    };
    stubConversationApi(api);

    const outcome = await moveChatToProject(fakePage(), {
      chat: CHAT_ID,
      project: "Portfolio",
      projectId: PORTFOLIO_PROJECT_ID,
    });

    expect(outcome.alreadyFiled).toBe(true);
    expect(api.patchBodies).toEqual([]);
  });

  it("returns rateLimited when the move is answered with HTTP 429", async () => {
    const api: FakeConversationApi = {
      conversationTemplateId: null,
      patchStatus: 429,
      acceptsPatch: false,
      patchBodies: [],
    };
    stubConversationApi(api);

    const outcome = await moveChatToProject(fakePage(), {
      chat: CHAT_ID,
      project: "Portfolio",
      projectId: PORTFOLIO_PROJECT_ID,
    });

    expect(outcome.rateLimited).toBe(true);
    expect(outcome.moved).toBe(false);
  });

  it("does not report the move as done when ChatGPT still shows the chat loose", async () => {
    const api: FakeConversationApi = {
      conversationTemplateId: null,
      patchStatus: 200,
      acceptsPatch: false,
      patchBodies: [],
    };
    stubConversationApi(api);

    const outcome = await moveChatToProject(fakePage(), {
      chat: CHAT_ID,
      project: "Portfolio",
      projectId: PORTFOLIO_PROJECT_ID,
    });

    expect(outcome.moved).toBe(false);
    expect(outcome.reason).toBe('ChatGPT did not confirm the move into project "Portfolio"');
  });
});
