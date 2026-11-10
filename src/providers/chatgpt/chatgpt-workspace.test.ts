import type { Page } from "playwright";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  moveChatToProject,
  readProjectNameFromDirectoryString,
  renameChat,
  stripConversationId,
} from "./chatgpt-workspace.ts";

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
    expect(readProjectNameFromDirectoryString("Yoga App\n1w")).toBe("Yoga App");
  });

  it("ignores the Projects directory header", () => {
    expect(readProjectNameFromDirectoryString("Name\nModified")).toBeNull();
  });

  it("preserves a project named Name", () => {
    expect(readProjectNameFromDirectoryString("Name\nToday")).toBe("Name");
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

const createFakePage = (): Page => {
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
      const patchFields = JSON.parse(String(init?.body)) as { gizmo_id: string };
      api.patchBodies.push(patchFields);

      if (api.acceptsPatch) api.conversationTemplateId = patchFields.gizmo_id;

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

    const verdict = await moveChatToProject(createFakePage(), {
      chat: CHAT_ID,
      project: "Portfolio",
      projectId: PORTFOLIO_PROJECT_ID,
    });

    expect(verdict.moved).toBe(true);
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

    const moveVerdict = await moveChatToProject(createFakePage(), {
      chat: CHAT_ID,
      project: "Portfolio",
      projectId: PORTFOLIO_PROJECT_ID,
    });

    expect(moveVerdict.alreadyFiled).toBe(true);
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

    const moveVerdict = await moveChatToProject(createFakePage(), {
      chat: CHAT_ID,
      project: "Portfolio",
      projectId: PORTFOLIO_PROJECT_ID,
    });

    expect(moveVerdict.rateLimited).toBe(true);
    expect(moveVerdict.moved).toBe(false);
  });

  it("does not report the move as done when ChatGPT still shows the chat loose", async () => {
    const api: FakeConversationApi = {
      conversationTemplateId: null,
      patchStatus: 200,
      acceptsPatch: false,
      patchBodies: [],
    };
    stubConversationApi(api);

    const moveVerdict = await moveChatToProject(createFakePage(), {
      chat: CHAT_ID,
      project: "Portfolio",
      projectId: PORTFOLIO_PROJECT_ID,
    });

    expect(moveVerdict.moved).toBe(false);
    expect(moveVerdict.reason).toBe('ChatGPT did not confirm the move into project "Portfolio"');
  });
});

interface FakeRenameApi {
  title: string;
  patchStatus: number;
  acceptsPatch: boolean;
  patchBodies: unknown[];
}

const RENAMED_TITLE = "Project docs: Garden Notes";

const stubRenameApi = (api: FakeRenameApi): void => {
  vi.stubGlobal("fetch", async (requestPath: string, init?: RequestInit) => {
    const isSessionRequest = requestPath === "/api/auth/session";
    if (isSessionRequest) return Response.json({ accessToken: "test-access-token" });

    const isPatchRequest = init?.method === "PATCH";
    if (isPatchRequest) {
      const patchFields = JSON.parse(String(init?.body)) as { title: string };
      api.patchBodies.push(patchFields);

      if (api.acceptsPatch) api.title = patchFields.title;

      return new Response("", { status: api.patchStatus });
    }

    return Response.json({ conversation_template_id: null, title: api.title });
  });
};

describe("renameChat", () => {
  it("renames the chat with one PATCH and returns the title a GET confirms", async () => {
    const api: FakeRenameApi = {
      title: "Saved",
      patchStatus: 200,
      acceptsPatch: true,
      patchBodies: [],
    };
    stubRenameApi(api);

    const renamedChat = await renameChat(createFakePage(), { chat: CHAT_ID, title: RENAMED_TITLE });

    expect(renamedChat).toEqual({ id: CHAT_ID, title: RENAMED_TITLE });
    expect(api.patchBodies).toEqual([{ title: RENAMED_TITLE }]);
  });

  it("throws a rate-limit error when the rename is answered with HTTP 429", async () => {
    const api: FakeRenameApi = {
      title: "Saved",
      patchStatus: 429,
      acceptsPatch: false,
      patchBodies: [],
    };
    stubRenameApi(api);

    const renaming = renameChat(createFakePage(), { chat: CHAT_ID, title: RENAMED_TITLE });

    await expect(renaming).rejects.toThrow("ChatGPT rate-limited the chat rename (HTTP 429)");
  });

  it("throws on any other failed rename reply", async () => {
    const api: FakeRenameApi = {
      title: "Saved",
      patchStatus: 500,
      acceptsPatch: false,
      patchBodies: [],
    };
    stubRenameApi(api);

    const renaming = renameChat(createFakePage(), { chat: CHAT_ID, title: RENAMED_TITLE });

    await expect(renaming).rejects.toThrow("ChatGPT chat rename failed with HTTP 500.");
  });

  it("throws when the GET still shows the old title after the PATCH", async () => {
    const api: FakeRenameApi = {
      title: "Saved",
      patchStatus: 200,
      acceptsPatch: false,
      patchBodies: [],
    };
    stubRenameApi(api);

    const renaming = renameChat(createFakePage(), { chat: CHAT_ID, title: RENAMED_TITLE });

    await expect(renaming).rejects.toThrow("did not confirm the new title");
  });
});
