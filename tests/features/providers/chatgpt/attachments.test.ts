import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Page } from "playwright";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type DomSnapshotNode,
  extractAllMessages,
  extractAssistantContent,
  loadManifest,
} from "../../../../src/features/providers/chatgpt/chatgptPage.ts";

interface SerializedMessageFixture {
  role: string;
  messageIndex: number;
  text: string;
  root: DomSnapshotNode;
}

const originalCwd = process.cwd();
let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "bridge-attachments-"));
  process.chdir(tempDir);
});

afterEach(async () => {
  process.chdir(originalCwd);
  await rm(tempDir, { recursive: true, force: true });
});

describe("attachment extraction", () => {
  it("extracts an image-only assistant message", async () => {
    const result = await extractAssistantContent(
      pageWithLast(
        assistantMessage([
          el("img", {
            alt: "chart.png",
            src: "https://example.test/chart.png",
          }),
        ]),
      ),
      { conversationId: "conv-image" },
    );

    expect(result.text).toBe("[image-1]");
    expect(result.attachments).toMatchObject([
      {
        id: "image-1",
        role: "assistant",
        kind: "image",
        url: "https://example.test/chart.png",
        filename: "chart.png",
        messageIndex: 0,
      },
    ]);
  });

  it("registers a generated estuary image in an image-only assistant turn", async () => {
    const result = await extractAssistantContent(
      pageWithLast(
        assistantMessage([
          el("img", {
            src: "https://chatgpt.com/backend-api/estuary/content?id=file_abc&ts=1&sig=x",
            alt: "Generated image: a fox",
          }),
        ]),
      ),
      { conversationId: "conv-generated" },
    );

    expect(result.text).toBe("[image-1]");
    expect(result.attachments).toMatchObject([
      {
        id: "image-1",
        role: "assistant",
        kind: "image",
        url: "https://chatgpt.com/backend-api/estuary/content?id=file_abc&ts=1&sig=x",
        filename: "Generated image: a fox",
        messageIndex: 0,
      },
    ]);
  });

  it("captures text and a generated estuary image inline in a mixed turn", async () => {
    const result = await extractAssistantContent(
      pageWithLast(
        assistantMessage([
          text("Here you go "),
          el("img", {
            src: "https://chatgpt.com/backend-api/estuary/content?id=file_xyz&ts=2&sig=y",
            alt: "Generated image: a cat",
          }),
        ]),
      ),
      { conversationId: "conv-generated-mixed" },
    );

    expect(result.text).toBe("Here you go [image-1]");
    expect(result.attachments).toMatchObject([
      {
        id: "image-1",
        role: "assistant",
        kind: "image",
        url: "https://chatgpt.com/backend-api/estuary/content?id=file_xyz&ts=2&sig=y",
        filename: "Generated image: a cat",
      },
    ]);
  });

  it("keeps mixed text and image placeholders inline", async () => {
    const result = await extractAssistantContent(
      pageWithLast(
        assistantMessage([
          text("Here is "),
          el("img", { src: "blob:https://chatgpt.test/image" }),
          text(" done"),
        ]),
      ),
      { conversationId: "conv-mixed" },
    );

    expect(result.text).toBe("Here is [image-1] done");
  });

  it("extracts PDF iframes as pdf attachments", async () => {
    const result = await extractAssistantContent(
      pageWithLast(
        assistantMessage([
          text("Preview "),
          el("iframe", { src: "https://example.test/output.pdf", title: "output.pdf" }),
        ]),
      ),
      { conversationId: "conv-pdf" },
    );

    expect(result.text).toBe("Preview [pdf-1]");
    expect(result.attachments).toMatchObject([
      {
        id: "pdf-1",
        kind: "pdf",
        mime: "application/pdf",
        filename: "output.pdf",
      },
    ]);
  });

  it("extracts assistant file download links without changing user messages", async () => {
    const messages = await extractAllMessages(
      pageWithAll([
        userMessage("upload.csv"),
        assistantMessage([
          text("Result: "),
          el("a", { download: "result.csv", href: "blob:https://chatgpt.test/result" }, [
            text("result.csv"),
          ]),
        ]),
      ]),
      { conversationId: "conv-file" },
    );

    expect(messages).toMatchObject([
      { role: "user", content: "upload.csv", attachments: [] },
      {
        role: "assistant",
        content: "Result: [file-1]",
        attachments: [{ id: "file-1", role: "assistant", kind: "file", filename: "result.csv" }],
      },
    ]);
  });

  it("skips user attachments by default", async () => {
    const messages = await extractAllMessages(
      pageWithAll([
        userMessage([
          text("Uploaded "),
          el("img", { alt: "user.png", src: "https://example.test/user.png" }),
        ]),
        assistantMessage([text("Received")]),
      ]),
      { conversationId: "conv-user-opt-out" },
    );
    const manifest = await loadManifest("conv-user-opt-out");

    expect(messages).toMatchObject([
      { role: "user", content: "Uploaded ", attachments: [] },
      { role: "assistant", content: "Received", attachments: [] },
    ]);
    expect(manifest.attachments).toEqual([]);
  });

  it("includes user attachments when opted in with user-prefixed ids", async () => {
    const messages = await extractAllMessages(
      pageWithAll([
        userMessage([
          text("Uploaded "),
          el("img", { alt: "user.png", src: "https://example.test/user.png" }),
        ]),
        assistantMessage([text("Received")]),
      ]),
      { conversationId: "conv-user-opt-in", includeUserAttachments: true },
    );
    const manifest = await loadManifest("conv-user-opt-in");

    expect(messages).toMatchObject([
      {
        role: "user",
        content: "Uploaded [user-image-1]",
        attachments: [
          {
            id: "user-image-1",
            role: "user",
            kind: "image",
            filename: "user.png",
          },
        ],
      },
      { role: "assistant", content: "Received", attachments: [] },
    ]);
    expect(manifest.attachments).toMatchObject([
      {
        id: "user-image-1",
        role: "user",
        kind: "image",
      },
    ]);
  });

  it("increments counters independently per role and kind", async () => {
    const messages = await extractAllMessages(
      pageWithAll([
        userMessage([el("img", { src: "https://example.test/user-1.png" })]),
        assistantMessage([el("img", { src: "https://example.test/assistant-1.png" })]),
        userMessage([el("img", { src: "https://example.test/user-2.png" })]),
        assistantMessage([el("img", { src: "https://example.test/assistant-2.png" })]),
      ]),
      { conversationId: "conv-role-counters", includeUserAttachments: true },
    );
    const manifest = await loadManifest("conv-role-counters");

    expect(
      messages.flatMap((message) => message.attachments.map((attachment) => attachment.id)),
    ).toEqual(["user-image-1", "image-1", "user-image-2", "image-2"]);
    expect(manifest.counters?.user.image).toBe(2);
    expect(manifest.counters?.assistant.image).toBe(2);
    expect(manifest.attachments.map((attachment) => `${attachment.role}:${attachment.id}`)).toEqual(
      ["user:user-image-1", "assistant:image-1", "user:user-image-2", "assistant:image-2"],
    );
  });

  it("persists counters across extractions in one conversation", async () => {
    const first = await extractAssistantContent(
      pageWithLast(assistantMessage([el("img", { src: "https://example.test/first.png" })])),
      { conversationId: "conv-counter" },
    );
    const firstAgain = await extractAssistantContent(
      pageWithLast(assistantMessage([el("img", { src: "https://example.test/first.png" })])),
      { conversationId: "conv-counter" },
    );
    const second = await extractAssistantContent(
      pageWithLast(assistantMessage([el("img", { src: "https://example.test/second.png" })])),
      { conversationId: "conv-counter" },
    );
    const manifest = await loadManifest("conv-counter");

    expect(first.text).toBe("[image-1]");
    expect(firstAgain.text).toBe("[image-1]");
    expect(second.text).toBe("[image-2]");
    expect(manifest.counters?.assistant.image).toBe(2);
    expect(manifest.attachments.map((attachment) => attachment.id)).toEqual(["image-1", "image-2"]);
  });
});

function pageWithLast(message: SerializedMessageFixture): Page {
  return {
    evaluate: async <Result>(): Promise<Result> => message as Result,
  } as unknown as Page;
}

function pageWithAll(messages: SerializedMessageFixture[]): Page {
  return {
    evaluate: async <Result>(): Promise<Result> => messages as Result,
  } as unknown as Page;
}

function assistantMessage(children: DomSnapshotNode[]): SerializedMessageFixture {
  return {
    role: "assistant",
    messageIndex: 0,
    text: children.map(textContent).join(""),
    root: el("div", { "data-message-author-role": "assistant" }, children),
  };
}

function userMessage(content: string | DomSnapshotNode[]): SerializedMessageFixture {
  const children = typeof content === "string" ? [text(content)] : content;
  return {
    role: "user",
    messageIndex: -1,
    text: children.map(textContent).join(""),
    root: el("div", { "data-message-author-role": "user" }, children),
  };
}

function el(
  tagName: string,
  attributes: Record<string, string> = {},
  children: DomSnapshotNode[] = [],
): DomSnapshotNode {
  return { type: "element", tagName, attributes, children };
}

function text(value: string): DomSnapshotNode {
  return { type: "text", text: value };
}

function textContent(node: DomSnapshotNode): string {
  if (node.type === "text") return node.text;
  return node.children.map(textContent).join("");
}
