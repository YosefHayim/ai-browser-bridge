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
} from "./chatgpt-page.ts";

type SerializedMessageFixture = {
  role: string;
  messageIndex: number;
  text: string;
  root: DomSnapshotNode;
};

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
      createPageWithLast(
        createAssistantMessage([
          createDomElement("img", {
            alt: "chart.png",
            src: "https://example.test/chart.png",
          }),
        ]),
      ),
      { conversationId: "conv-image", ...createManifestOptions() },
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
      createPageWithLast(
        createAssistantMessage([
          createDomElement("img", {
            src: "https://chatgpt.com/backend-api/estuary/content?id=file_abc&ts=1&sig=x",
            alt: "Generated image: a fox",
          }),
        ]),
      ),
      { conversationId: "conv-generated", ...createManifestOptions() },
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
      createPageWithLast(
        createAssistantMessage([
          createTextNode("Here you go "),
          createDomElement("img", {
            src: "https://chatgpt.com/backend-api/estuary/content?id=file_xyz&ts=2&sig=y",
            alt: "Generated image: a cat",
          }),
        ]),
      ),
      { conversationId: "conv-generated-mixed", ...createManifestOptions() },
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
      createPageWithLast(
        createAssistantMessage([
          createTextNode("Here is "),
          createDomElement("img", { src: "blob:https://chatgpt.test/image" }),
          createTextNode(" done"),
        ]),
      ),
      { conversationId: "conv-mixed", ...createManifestOptions() },
    );

    expect(result.text).toBe("Here is [image-1] done");
  });

  it("extracts PDF iframes as pdf attachments", async () => {
    const result = await extractAssistantContent(
      createPageWithLast(
        createAssistantMessage([
          createTextNode("Preview "),
          createDomElement("iframe", {
            src: "https://example.test/output.pdf",
            title: "output.pdf",
          }),
        ]),
      ),
      { conversationId: "conv-pdf", ...createManifestOptions() },
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
      createPageWithAll([
        createUserMessage("upload.csv"),
        createAssistantMessage([
          createTextNode("Result: "),
          createDomElement(
            "a",
            { download: "result.csv", href: "blob:https://chatgpt.test/result" },
            [createTextNode("result.csv")],
          ),
        ]),
      ]),
      { conversationId: "conv-file", ...createManifestOptions() },
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
      createPageWithAll([
        createUserMessage([
          createTextNode("Uploaded "),
          createDomElement("img", { alt: "user.png", src: "https://example.test/user.png" }),
        ]),
        createAssistantMessage([createTextNode("Received")]),
      ]),
      { conversationId: "conv-user-opt-out", ...createManifestOptions() },
    );
    const manifest = await loadManifest("conv-user-opt-out", createManifestOptions());

    expect(messages).toMatchObject([
      { role: "user", content: "Uploaded ", attachments: [] },
      { role: "assistant", content: "Received", attachments: [] },
    ]);
    expect(manifest.attachments).toEqual([]);
  });

  it("includes user attachments when opted in with user-prefixed ids", async () => {
    const messages = await extractAllMessages(
      createPageWithAll([
        createUserMessage([
          createTextNode("Uploaded "),
          createDomElement("img", { alt: "user.png", src: "https://example.test/user.png" }),
        ]),
        createAssistantMessage([createTextNode("Received")]),
      ]),
      {
        conversationId: "conv-user-opt-in",
        includeUserAttachments: true,
        ...createManifestOptions(),
      },
    );
    const manifest = await loadManifest("conv-user-opt-in", createManifestOptions());

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
      createPageWithAll([
        createUserMessage([createDomElement("img", { src: "https://example.test/user-1.png" })]),
        createAssistantMessage([
          createDomElement("img", { src: "https://example.test/assistant-1.png" }),
        ]),
        createUserMessage([createDomElement("img", { src: "https://example.test/user-2.png" })]),
        createAssistantMessage([
          createDomElement("img", { src: "https://example.test/assistant-2.png" }),
        ]),
      ]),
      {
        conversationId: "conv-role-counters",
        includeUserAttachments: true,
        ...createManifestOptions(),
      },
    );
    const manifest = await loadManifest("conv-role-counters", createManifestOptions());

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
      createPageWithLast(
        createAssistantMessage([
          createDomElement("img", { src: "https://example.test/first.png" }),
        ]),
      ),
      { conversationId: "conv-counter", ...createManifestOptions() },
    );
    const firstAgain = await extractAssistantContent(
      createPageWithLast(
        createAssistantMessage([
          createDomElement("img", { src: "https://example.test/first.png" }),
        ]),
      ),
      { conversationId: "conv-counter", ...createManifestOptions() },
    );
    const second = await extractAssistantContent(
      createPageWithLast(
        createAssistantMessage([
          createDomElement("img", { src: "https://example.test/second.png" }),
        ]),
      ),
      { conversationId: "conv-counter", ...createManifestOptions() },
    );
    const manifest = await loadManifest("conv-counter", createManifestOptions());

    expect(first.text).toBe("[image-1]");
    expect(firstAgain.text).toBe("[image-1]");
    expect(second.text).toBe("[image-2]");
    expect(manifest.counters?.assistant.image).toBe(2);
    expect(manifest.attachments.map((attachment) => attachment.id)).toEqual(["image-1", "image-2"]);
  });

  it("keeps a generated image's id and takes its new blob URL after a reload", async () => {
    const createGeneratedImage = (src: string): DomSnapshotNode =>
      createDomElement("img", { alt: "Generated image 1", src });
    await extractAllMessages(
      createPageWithAll([
        createAssistantMessage([createGeneratedImage("blob:https://chatgpt.com/first-load")]),
      ]),
      { conversationId: "conv-blob-reload", ...createManifestOptions() },
    );
    const afterReload = await extractAllMessages(
      createPageWithAll([
        createAssistantMessage([createGeneratedImage("blob:https://chatgpt.com/second-load")]),
      ]),
      { conversationId: "conv-blob-reload", ...createManifestOptions() },
    );
    const manifest = await loadManifest("conv-blob-reload", createManifestOptions());

    expect(afterReload).toMatchObject([{ role: "assistant", content: "[image-1]" }]);
    expect(manifest.attachments).toMatchObject([
      {
        id: "image-1",
        url: "blob:https://chatgpt.com/second-load",
        filename: "Generated image 1",
      },
    ]);
  });

  it("registers a different generated image in the same turn as a new attachment", async () => {
    await extractAllMessages(
      createPageWithAll([
        createAssistantMessage([
          createDomElement("img", { alt: "Generated image 1", src: "blob:https://a.test/1" }),
        ]),
      ]),
      { conversationId: "conv-blob-pair", ...createManifestOptions() },
    );
    await extractAllMessages(
      createPageWithAll([
        createAssistantMessage([
          createDomElement("img", { alt: "Generated image 1", src: "blob:https://a.test/3" }),
          createDomElement("img", { alt: "Generated image 2", src: "blob:https://a.test/4" }),
        ]),
      ]),
      { conversationId: "conv-blob-pair", ...createManifestOptions() },
    );
    const manifest = await loadManifest("conv-blob-pair", createManifestOptions());

    expect(manifest.attachments).toMatchObject([
      { id: "image-1", url: "blob:https://a.test/3", filename: "Generated image 1" },
      { id: "image-2", url: "blob:https://a.test/4", filename: "Generated image 2" },
    ]);
  });
});

const createManifestOptions = (): { manifestRoot: string } => ({
  manifestRoot: path.join(tempDir, "manifests"),
});

const createPageWithLast = (message: SerializedMessageFixture): Page => {
  return {
    evaluate: async <Result>(): Promise<Result> => message as Result,
  } as unknown as Page;
};

const createPageWithAll = (messages: SerializedMessageFixture[]): Page => {
  return {
    evaluate: async <Result>(): Promise<Result> => messages as Result,
  } as unknown as Page;
};

const createAssistantMessage = (children: DomSnapshotNode[]): SerializedMessageFixture => {
  return {
    role: "assistant",
    messageIndex: 0,
    text: children.map(createTextContent).join(""),
    root: createDomElement("div", { "data-message-author-role": "assistant" }, children),
  };
};

const createUserMessage = (content: string | DomSnapshotNode[]): SerializedMessageFixture => {
  const isTypeString = typeof content === "string";
  const children = isTypeString ? [createTextNode(content)] : content;
  return {
    role: "user",
    messageIndex: -1,
    text: children.map(createTextContent).join(""),
    root: createDomElement("div", { "data-message-author-role": "user" }, children),
  };
};

const createDomElement = (
  tagName: string,
  attributes: Record<string, string> = {},
  children: DomSnapshotNode[] = [],
): DomSnapshotNode => {
  return { type: "element", tagName, attributes, children };
};

const createTextNode = (value: string): DomSnapshotNode => {
  return { type: "text", text: value };
};

const createTextContent = (node: DomSnapshotNode): string => {
  const isNodeTypeText = node.type === "text";
  if (isNodeTypeText) return node.text;

  return node.children.map(createTextContent).join("");
};
