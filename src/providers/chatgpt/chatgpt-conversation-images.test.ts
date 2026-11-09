import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Page } from "playwright";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AttachmentManifest } from "@/domain/attachment-types.ts";
import {
  attachmentsFromImageRefs,
  type ConversationReply,
  listConversationImageRefs,
  readChatGptFileDownloadUrl,
} from "./chatgpt-conversation-images.ts";
import {
  downloadAttachment,
  loadManifest,
  registerConversationImages,
  saveManifest,
} from "./chatgpt-page.ts";

const CONVERSATION_ID = "conv-1";
const FIRST_FILE_URL = "https://files.example.test/first.png";

const conversationFixture: ConversationReply = {
  mapping: {
    promptNode: {
      message: {
        author: { role: "user" },
        create_time: 100,
        content: { parts: ["draw a fox"] },
      },
    },
    secondImageNode: {
      message: {
        author: { role: "tool" },
        create_time: 300,
        content: {
          parts: [{ content_type: "image_asset_pointer", asset_pointer: "sediment://file_second" }],
        },
      },
    },
    firstImageNode: {
      message: {
        author: { role: "tool" },
        create_time: 200,
        content: {
          parts: [
            { content_type: "image_asset_pointer", asset_pointer: "file-service://file-first" },
          ],
        },
      },
    },
    emptyNode: { message: null },
  },
};

const originalCwd = process.cwd();
let tempDir: string;

beforeEach(async () => {
  tempDir = await realpath(await mkdtemp(path.join(os.tmpdir(), "bridge-conversation-images-")));
  process.chdir(tempDir);
});

afterEach(async () => {
  process.chdir(originalCwd);
  vi.unstubAllGlobals();
  await rm(tempDir, { recursive: true, force: true });
});

const stubChatGptApi = (routes: Record<string, unknown>): string[] => {
  const authorizations: string[] = [];
  const defaultRoutes = { "/api/auth/session": { accessToken: "test-access-token" } };
  vi.stubGlobal("fetch", async (requestPath: string, init?: RequestInit) => {
    const authorization = new Headers(init?.headers).get("Authorization");

    const hasAuthorization = authorization !== null;
    if (hasAuthorization) authorizations.push(authorization);

    const reply = { ...defaultRoutes, ...routes }[requestPath];

    const isReplyMissing = reply === undefined;
    if (isReplyMissing) return new Response("not found", { status: 404 });

    return Response.json(reply);
  });
  return authorizations;
};

const pageRunningInChatGpt = (requestedUrls: string[], imageBytes: Buffer): Page => {
  return {
    evaluate: async (pageFunction: (argument: string) => Promise<unknown>, argument: string) =>
      pageFunction(argument),
    context: () => ({
      request: {
        get: async (url: string) => {
          requestedUrls.push(url);
          return {
            ok: () => true,
            status: () => 200,
            headers: () => ({ "content-type": "image/png" }),
            body: async () => imageBytes,
          };
        },
      },
    }),
  } as unknown as Page;
};

const manifestRootOf = (): string => path.join(tempDir, "manifests");

describe("listConversationImageRefs", () => {
  it("orders image pointers by message create time", () => {
    const refs = listConversationImageRefs(conversationFixture);

    expect(refs.map((ref) => ref.fileId)).toEqual(["file-first", "file_second"]);
  });

  it("labels images from user messages as user images", () => {
    const conversation: ConversationReply = {
      mapping: {
        uploadNode: {
          message: {
            author: { role: "user" },
            create_time: 50,
            content: {
              parts: [
                { content_type: "image_asset_pointer", asset_pointer: "file-service://file-up" },
              ],
            },
          },
        },
      },
    };

    const refs = listConversationImageRefs(conversation);

    expect(refs).toEqual([{ fileId: "file-up", role: "user", createTime: 50 }]);
  });

  it("throws when an image pointer has an unknown scheme", () => {
    const conversation: ConversationReply = {
      mapping: {
        badNode: {
          message: {
            author: { role: "tool" },
            create_time: 1,
            content: {
              parts: [{ content_type: "image_asset_pointer", asset_pointer: "https://x.test/a" }],
            },
          },
        },
      },
    };

    expect(() => listConversationImageRefs(conversation)).toThrow("unknown scheme");
  });
});

describe("attachmentsFromImageRefs", () => {
  it("numbers images in conversation order with padded filenames", () => {
    const refs = [
      { fileId: "file-first", role: "assistant" as const, createTime: 1 },
      { fileId: "file-second", role: "assistant" as const, createTime: 2 },
      { fileId: "file-up", role: "user" as const, createTime: 3 },
    ];

    const attachments = attachmentsFromImageRefs({ refs, createdAt: "2026-11-05T00:00:00.000Z" });

    expect(attachments.map((attachment) => [attachment.id, attachment.filename])).toEqual([
      ["image-1", "image-01"],
      ["image-2", "image-02"],
      ["user-image-1", "user-image-01"],
    ]);
    expect(attachments[1]?.url).toBe("chatgpt-file:file-second");
  });
});

describe("readChatGptFileDownloadUrl", () => {
  it("sends the session access token and returns the download link", async () => {
    const authorizations = stubChatGptApi({
      "/backend-api/files/download/file-first?conversation_id=conv-1&inline=false": {
        download_url: FIRST_FILE_URL,
      },
    });
    const page = pageRunningInChatGpt([], Buffer.alloc(0));

    const downloadUrl = await readChatGptFileDownloadUrl({
      page,
      conversationId: CONVERSATION_ID,
      fileId: "file-first",
    });

    expect(downloadUrl).toBe(FIRST_FILE_URL);
    expect(authorizations).toEqual(["Bearer test-access-token"]);
  });

  it("throws when the session has no access token", async () => {
    stubChatGptApi({ "/api/auth/session": {} });
    const page = pageRunningInChatGpt([], Buffer.alloc(0));

    await expect(
      readChatGptFileDownloadUrl({ page, conversationId: CONVERSATION_ID, fileId: "file-first" }),
    ).rejects.toThrow("no access token");
  });
});

describe("registerConversationImages", () => {
  it("replaces image attachments with the conversation images and keeps file attachments", async () => {
    stubChatGptApi({
      [`/backend-api/conversation/${CONVERSATION_ID}`]: conversationFixture,
    });
    const seededManifest: AttachmentManifest = {
      conversationId: CONVERSATION_ID,
      attachments: [
        {
          id: "file-1",
          role: "assistant",
          kind: "file",
          url: "https://example.test/report.csv",
          messageIndex: 0,
          createdAt: "2026-11-05T00:00:00.000Z",
        },
        {
          id: "image-1",
          role: "assistant",
          kind: "image",
          url: "blob:https://chatgpt.com/old",
          messageIndex: 0,
          createdAt: "2026-11-05T00:00:00.000Z",
        },
      ],
    };
    await saveManifest(seededManifest, { manifestRoot: manifestRootOf() });

    await registerConversationImages({
      page: pageRunningInChatGpt([], Buffer.alloc(0)),
      conversationId: CONVERSATION_ID,
      manifestRoot: manifestRootOf(),
    });
    const manifest = await loadManifest(CONVERSATION_ID, { manifestRoot: manifestRootOf() });

    expect(manifest.attachments.map((attachment) => [attachment.id, attachment.url])).toEqual([
      ["file-1", "https://example.test/report.csv"],
      ["image-1", "chatgpt-file:file-first"],
      ["image-2", "chatgpt-file:file_second"],
    ]);
  });
});

describe("downloadAttachment", () => {
  it("saves a ChatGPT-hosted image under its conversation-order name", async () => {
    stubChatGptApi({
      "/backend-api/files/download/file-first?conversation_id=conv-1&inline=false": {
        download_url: FIRST_FILE_URL,
      },
    });
    const imageAttachments = attachmentsFromImageRefs({
      refs: [{ fileId: "file-first", role: "assistant", createTime: 1 }],
      createdAt: "2026-11-05T00:00:00.000Z",
    });
    await saveManifest(
      { conversationId: CONVERSATION_ID, attachments: imageAttachments },
      { manifestRoot: manifestRootOf() },
    );
    const requestedUrls: string[] = [];
    const imageBytes = Buffer.from("png-bytes");

    const result = await downloadAttachment(
      pageRunningInChatGpt(requestedUrls, imageBytes),
      CONVERSATION_ID,
      "image-1",
      { repoRoot: tempDir, manifestRoot: manifestRootOf(), outDir: path.join(tempDir, "out") },
    );

    expect(path.basename(result.path)).toBe("image-01.png");
    expect(requestedUrls).toEqual([FIRST_FILE_URL]);
    await expect(readFile(result.path, "utf8")).resolves.toBe("png-bytes");
  });
});
