import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Page } from "playwright";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type DomSnapshotNode,
  extractAllMessages,
  extractAssistantMessage,
  loadManifest,
} from "./chatgpt-page.ts";

type SerializedMessageFixture = {
  role: string;
  messageIndex: number;
  text: string;
  root: DomSnapshotNode;
};

const originalCwd = process.cwd();
let scratchDir: string;

beforeEach(async () => {
  scratchDir = await mkdtemp(path.join(os.tmpdir(), "bridge-attachments-"));
  process.chdir(scratchDir);
});

afterEach(async () => {
  process.chdir(originalCwd);
  await rm(scratchDir, { recursive: true, force: true });
});

describe("attachment extraction", () => {
  it("extracts an image-only assistant message", async () => {
    const report = await extractAssistantMessage(
      createPageWithLast(
        createAssistantMessage([
          createDomElement("img", {
            alt: "chart.png",
            src: "https://example.test/chart.png",
          }),
        ]),
      ),
      { conversationId: "conv-image", ...createManifestSettings() },
    );

    expect(report.text).toBe("[image-1]");
    expect(report.attachments).toMatchObject([
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
    const extractedMessage = await extractAssistantMessage(
      createPageWithLast(
        createAssistantMessage([
          createDomElement("img", {
            src: "https://chatgpt.com/backend-api/estuary/content?id=file_abc&ts=1&sig=x",
            alt: "Generated image: a fox",
          }),
        ]),
      ),
      { conversationId: "conv-generated", ...createManifestSettings() },
    );

    expect(extractedMessage.text).toBe("[image-1]");
    expect(extractedMessage.attachments).toMatchObject([
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
    const extractedMessage = await extractAssistantMessage(
      createPageWithLast(
        createAssistantMessage([
          createStringNode("Here you go "),
          createDomElement("img", {
            src: "https://chatgpt.com/backend-api/estuary/content?id=file_xyz&ts=2&sig=y",
            alt: "Generated image: a cat",
          }),
        ]),
      ),
      { conversationId: "conv-generated-mixed", ...createManifestSettings() },
    );

    expect(extractedMessage.text).toBe("Here you go [image-1]");
    expect(extractedMessage.attachments).toMatchObject([
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
    const extractedMessage = await extractAssistantMessage(
      createPageWithLast(
        createAssistantMessage([
          createStringNode("Here is "),
          createDomElement("img", { src: "blob:https://chatgpt.test/image" }),
          createStringNode(" done"),
        ]),
      ),
      { conversationId: "conv-mixed", ...createManifestSettings() },
    );

    expect(extractedMessage.text).toBe("Here is [image-1] done");
  });

  it("extracts PDF iframes as pdf attachments", async () => {
    const extractedMessage = await extractAssistantMessage(
      createPageWithLast(
        createAssistantMessage([
          createStringNode("Preview "),
          createDomElement("iframe", {
            src: "https://example.test/output.pdf",
            title: "output.pdf",
          }),
        ]),
      ),
      { conversationId: "conv-pdf", ...createManifestSettings() },
    );

    expect(extractedMessage.text).toBe("Preview [pdf-1]");
    expect(extractedMessage.attachments).toMatchObject([
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
          createStringNode("Result: "),
          createDomElement(
            "a",
            { download: "result.csv", href: "blob:https://chatgpt.test/result" },
            [createStringNode("result.csv")],
          ),
        ]),
      ]),
      { conversationId: "conv-file", ...createManifestSettings() },
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
          createStringNode("Uploaded "),
          createDomElement("img", { alt: "user.png", src: "https://example.test/user.png" }),
        ]),
        createAssistantMessage([createStringNode("Received")]),
      ]),
      { conversationId: "conv-user-opt-out", ...createManifestSettings() },
    );
    const manifest = await loadManifest("conv-user-opt-out", createManifestSettings());

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
          createStringNode("Uploaded "),
          createDomElement("img", { alt: "user.png", src: "https://example.test/user.png" }),
        ]),
        createAssistantMessage([createStringNode("Received")]),
      ]),
      {
        conversationId: "conv-user-opt-in",
        includeUserAttachments: true,
        ...createManifestSettings(),
      },
    );
    const manifest = await loadManifest("conv-user-opt-in", createManifestSettings());

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
        ...createManifestSettings(),
      },
    );
    const manifest = await loadManifest("conv-role-counters", createManifestSettings());

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
    const first = await extractAssistantMessage(
      createPageWithLast(
        createAssistantMessage([
          createDomElement("img", { src: "https://example.test/first.png" }),
        ]),
      ),
      { conversationId: "conv-counter", ...createManifestSettings() },
    );
    const firstAgain = await extractAssistantMessage(
      createPageWithLast(
        createAssistantMessage([
          createDomElement("img", { src: "https://example.test/first.png" }),
        ]),
      ),
      { conversationId: "conv-counter", ...createManifestSettings() },
    );
    const second = await extractAssistantMessage(
      createPageWithLast(
        createAssistantMessage([
          createDomElement("img", { src: "https://example.test/second.png" }),
        ]),
      ),
      { conversationId: "conv-counter", ...createManifestSettings() },
    );
    const manifest = await loadManifest("conv-counter", createManifestSettings());

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
      { conversationId: "conv-blob-reload", ...createManifestSettings() },
    );
    const afterReload = await extractAllMessages(
      createPageWithAll([
        createAssistantMessage([createGeneratedImage("blob:https://chatgpt.com/second-load")]),
      ]),
      { conversationId: "conv-blob-reload", ...createManifestSettings() },
    );
    const manifest = await loadManifest("conv-blob-reload", createManifestSettings());

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
      { conversationId: "conv-blob-pair", ...createManifestSettings() },
    );
    await extractAllMessages(
      createPageWithAll([
        createAssistantMessage([
          createDomElement("img", { alt: "Generated image 1", src: "blob:https://a.test/3" }),
          createDomElement("img", { alt: "Generated image 2", src: "blob:https://a.test/4" }),
        ]),
      ]),
      { conversationId: "conv-blob-pair", ...createManifestSettings() },
    );
    const manifest = await loadManifest("conv-blob-pair", createManifestSettings());

    expect(manifest.attachments).toMatchObject([
      { id: "image-1", url: "blob:https://a.test/3", filename: "Generated image 1" },
      { id: "image-2", url: "blob:https://a.test/4", filename: "Generated image 2" },
    ]);
  });
});

const createManifestSettings = (): { manifestRoot: string } => ({
  manifestRoot: path.join(scratchDir, "manifests"),
});

const createPageWithLast = (message: SerializedMessageFixture): Page => {
  return {
    evaluate: async <Report>(): Promise<Report> => message as Report,
  } as unknown as Page;
};

const createPageWithAll = (messages: SerializedMessageFixture[]): Page => {
  return {
    evaluate: async <Messages>(): Promise<Messages> => messages as Messages,
  } as unknown as Page;
};

const createAssistantMessage = (children: DomSnapshotNode[]): SerializedMessageFixture => {
  return {
    role: "assistant",
    messageIndex: 0,
    text: children.map(createStringMessage).join(""),
    root: createDomElement("div", { "data-message-author-role": "assistant" }, children),
  };
};

const createUserMessage = (message: string | DomSnapshotNode[]): SerializedMessageFixture => {
  const isTypeString = typeof message === "string";
  const children = isTypeString ? [createStringNode(message)] : message;
  return {
    role: "user",
    messageIndex: -1,
    text: children.map(createStringMessage).join(""),
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

const createStringNode = (field: string): DomSnapshotNode => {
  return { type: "text", text: field };
};

const createStringMessage = (node: DomSnapshotNode): string => {
  const isNodeTypeString = node.type === "text";
  if (isNodeTypeString) return node.text;

  return node.children.map(createStringMessage).join("");
};
