import { describe, expect, it } from "vitest";
import { fakeDesignPage } from "@/testSupport/fakeDesignPage.ts";
import {
  activateDesignConversation,
  listDesignConversations,
  readDesignConversation,
  renameDesignConversation,
} from "./designConversation.ts";

const savedProject = {
  name: "Deck",
  hasThumbnail: true,
  viewState: { activeChatId: "c2", openFiles: ["index.html"] },
  chats: {
    c1: { id: "c1", title: "Chat", messages: [] },
    c2: {
      id: "c2",
      title: "Pitch deck",
      composer: { text: "draft" },
      messages: [
        { id: "m1", role: "user", content: "Make slides", timestamp: "t1" },
        { id: "m2", role: "assistant", kind: "chat-summary", content: "Done.", timestamp: "t2" },
      ],
    },
  },
  closedChats: [
    {
      id: "c0",
      title: "Moodboard",
      titleIsGenerated: true,
      messages: [{ id: "m0", role: "user", content: "Collect references" }],
    },
  ],
};

// GetProjectData answers with the saved project (version 42); writes answer version 43.
const designPageWithSavedProject = () =>
  fakeDesignPage({
    answerRpc: (call) => {
      if (call.method !== "GetProjectData") return { version: "43" };
      return { data: Buffer.from(JSON.stringify(savedProject)).toString("base64"), version: "42" };
    },
  });

const writtenDocument = (body: unknown): unknown => {
  const { data } = body as { data: string };
  return JSON.parse(Buffer.from(data, "base64").toString("utf8"));
};

describe("readDesignConversation", () => {
  it("reads the active Conversation's latest messages from the saved project", async () => {
    const { page } = designPageWithSavedProject();

    const read = await readDesignConversation(page, {
      projectId: "p1",
      conversationId: undefined,
      limit: 1,
    });

    expect(read.conversation).toEqual({
      id: "c2",
      title: "Pitch deck",
      messageCount: 2,
      lastOpened: undefined,
      active: true,
      open: true,
    });
    expect(read.messages).toEqual([
      { id: "m2", role: "assistant", kind: "chat-summary", content: "Done.", timestamp: "t2" },
    ]);
  });
});

describe("listDesignConversations", () => {
  it("lists the open Conversations, then the closed ones from the history", async () => {
    const { page } = designPageWithSavedProject();

    const conversations = await listDesignConversations(page, "p1");

    expect(
      conversations.map(({ id, title, active, open }) => ({ id, title, active, open })),
    ).toEqual([
      { id: "c1", title: "Chat", active: false, open: true },
      { id: "c2", title: "Pitch deck", active: true, open: true },
      { id: "c0", title: "Moodboard", active: false, open: false },
    ]);
  });
});

describe("renameDesignConversation", () => {
  it("writes the new title against the read version and keeps every other field", async () => {
    const { page, calls } = designPageWithSavedProject();

    await renameDesignConversation(page, { projectId: "p1", conversationId: "c1", title: "Logo" });

    const update = calls.find((call) => call.method === "UpdateProjectData");
    expect(update?.body).toMatchObject({ projectId: "p1", expectedVersion: "42" });
    expect(writtenDocument(update?.body)).toEqual({
      ...savedProject,
      chats: {
        ...savedProject.chats,
        c1: { id: "c1", title: "Logo", titleIsGenerated: false, messages: [] },
      },
    });
  });

  it("renames a closed Conversation in place", async () => {
    const { page, calls } = designPageWithSavedProject();

    await renameDesignConversation(page, { projectId: "p1", conversationId: "c0", title: "Refs" });

    const update = calls.find((call) => call.method === "UpdateProjectData");
    expect(writtenDocument(update?.body)).toEqual({
      ...savedProject,
      closedChats: [{ ...savedProject.closedChats[0], title: "Refs", titleIsGenerated: false }],
    });
  });

  it("refuses an unknown Conversation without writing", async () => {
    const { page, calls } = designPageWithSavedProject();

    await expect(
      renameDesignConversation(page, { projectId: "p1", conversationId: "nope", title: "x" }),
    ).rejects.toThrow("has no conversation nope");
    expect(calls.some((call) => call.method === "UpdateProjectData")).toBe(false);
  });
});

describe("activateDesignConversation", () => {
  it("reopens a closed Conversation and makes it active", async () => {
    const { page, calls } = designPageWithSavedProject();

    await activateDesignConversation(page, { projectId: "p1", conversationId: "c0" });

    const update = calls.find((call) => call.method === "UpdateProjectData");
    expect(writtenDocument(update?.body)).toEqual({
      ...savedProject,
      viewState: { ...savedProject.viewState, activeChatId: "c0" },
      chats: { ...savedProject.chats, c0: savedProject.closedChats[0] },
      closedChats: [],
    });
  });
});
