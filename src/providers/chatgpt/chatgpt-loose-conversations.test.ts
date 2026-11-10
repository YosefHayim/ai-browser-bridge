import type { Page } from "playwright";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ConversationListItem,
  isProjectConversation,
  looseConversationsFrom,
  readAllConversationItems,
} from "./chatgpt-loose-conversations.ts";

const LIST_PAGE_SIZE = 100;
const PROJECT_TEMPLATE_ID = "g-p-fixture-project";
const OTHER_GIZMO_TEMPLATE_ID = "g-fixture-gpt";

const fixtureItem = (index: number, templateId: string | null = null): ConversationListItem => {
  return {
    id: `chat-${index}`,
    title: `Fixture chat ${index}`,
    conversation_template_id: templateId,
  };
};

const listPageFor = (offset: number, total: number): Response => {
  const lastIndexOnPage = Math.min(offset + LIST_PAGE_SIZE, total);
  const items: ConversationListItem[] = [];
  for (let index = offset; index < lastIndexOnPage; index += 1) {
    items.push(fixtureItem(index));
  }
  return Response.json({ items, total });
};

const fakePage = (): Page => {
  return {
    evaluate: async (pageFunction: (argument: string) => Promise<unknown>, argument: string) =>
      pageFunction(argument),
  } as unknown as Page;
};

const stubConversationListApi = (replyForOffset: (offset: number) => Response): number[] => {
  const requestedOffsets: number[] = [];
  vi.stubGlobal("fetch", async (requestPath: string) => {
    const isSessionRequest = requestPath === "/api/auth/session";
    if (isSessionRequest) return Response.json({ accessToken: "test-access-token" });

    const requestUrl = new URL(requestPath, "https://chatgpt.com");
    const offset = Number(requestUrl.searchParams.get("offset"));
    requestedOffsets.push(offset);
    return replyForOffset(offset);
  });
  return requestedOffsets;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isProjectConversation", () => {
  it("returns true for a chat whose template id starts with g-p-", () => {
    const projectItem = fixtureItem(1, PROJECT_TEMPLATE_ID);

    expect(isProjectConversation(projectItem)).toBe(true);
  });

  it("returns false for a chat with no template id", () => {
    const looseItem = fixtureItem(1, null);

    expect(isProjectConversation(looseItem)).toBe(false);
  });

  it("returns false for a chat that belongs to a custom GPT rather than a Project", () => {
    const gizmoItem = fixtureItem(1, OTHER_GIZMO_TEMPLATE_ID);

    expect(isProjectConversation(gizmoItem)).toBe(false);
  });
});

describe("looseConversationsFrom", () => {
  it("keeps only the chats that are outside every Project", () => {
    const items = [
      fixtureItem(1),
      fixtureItem(2, PROJECT_TEMPLATE_ID),
      fixtureItem(3, OTHER_GIZMO_TEMPLATE_ID),
    ];

    const looseConversations = looseConversationsFrom(items);

    expect(looseConversations.map((conversation) => conversation.id)).toEqual(["chat-1", "chat-3"]);
  });

  it("builds the chatgpt.com URL and uses an empty title when the title is missing", () => {
    const items: ConversationListItem[] = [{ id: "chat-9", title: null }];

    expect(looseConversationsFrom(items)).toEqual([
      { id: "chat-9", title: "", url: "https://chatgpt.com/c/chat-9" },
    ]);
  });

  it("lists a chat once when the same id appears on two pages", () => {
    const items = [fixtureItem(1), fixtureItem(1)];

    expect(looseConversationsFrom(items)).toHaveLength(1);
  });
});

describe("readAllConversationItems", () => {
  it("reads every page until the reported total is reached", async () => {
    const requestedOffsets = stubConversationListApi((offset) => listPageFor(offset, 250));

    const items = await readAllConversationItems(fakePage());

    expect(items).toHaveLength(250);
    expect(requestedOffsets).toEqual([0, 100, 200]);
  });

  it("returns an empty list when the account has no conversations", async () => {
    stubConversationListApi((offset) => listPageFor(offset, 0));

    await expect(readAllConversationItems(fakePage())).resolves.toEqual([]);
  });

  it("throws when a list page fails with a non-200 status", async () => {
    stubConversationListApi((offset) => {
      const isSecondPage = offset === LIST_PAGE_SIZE;
      if (isSecondPage) return new Response("rate limited", { status: 429 });

      return listPageFor(offset, 250);
    });

    await expect(readAllConversationItems(fakePage())).rejects.toThrow("HTTP 429");
  });

  it("throws instead of returning a partial list when a page comes back empty early", async () => {
    stubConversationListApi((offset) => {
      const isSecondPage = offset === LIST_PAGE_SIZE;
      if (isSecondPage) return Response.json({ items: [], total: 250 });

      return listPageFor(offset, 250);
    });

    await expect(readAllConversationItems(fakePage())).rejects.toThrow("stopped at 100 of 250");
  });
});
