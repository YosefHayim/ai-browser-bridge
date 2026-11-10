import { describe, expect, it } from "vitest";
import {
  createDownloadLine,
  parseAttachmentIds,
  readConversationIdFromOption,
} from "./cli-operations.ts";

describe("parseAttachmentIds", () => {
  it("returns null when no values are given", () => {
    expect(parseAttachmentIds(undefined)).toBeNull();
  });

  it("flattens comma-separated values into a flat id list", () => {
    expect(parseAttachmentIds(["a", "b,c"])).toEqual(["a", "b", "c"]);
  });

  it("returns null when only blank values remain", () => {
    expect(parseAttachmentIds(["  "])).toBeNull();
  });

  it("trims whitespace around comma-separated ids", () => {
    expect(parseAttachmentIds(["a, b"])).toEqual(["a", "b"]);
  });
});

describe("formatDownloadLine", () => {
  it("formats a successful download with path and size", () => {
    expect(createDownloadLine({ id: "image-1", path: "/tmp/image-1.png", bytes: 12345 })).toBe(
      "image-1 -> /tmp/image-1.png (12345 bytes)",
    );
  });

  it("formats a failed download with its error message", () => {
    expect(createDownloadLine({ id: "image-1", path: "", bytes: 0, error: "not found" })).toBe(
      "image-1: not found",
    );
  });
});

describe("conversationIdFromOption", () => {
  it("keeps a bare chat id", () => {
    expect(readConversationIdFromOption("6ad3a201-95b8-83ed-a175-a8007d1a732a")).toBe(
      "6ad3a201-95b8-83ed-a175-a8007d1a732a",
    );
  });

  it("reads the chat id from a chat URL", () => {
    expect(
      readConversationIdFromOption("https://chatgpt.com/c/6ad3a201-95b8-83ed-a175-a8007d1a732a"),
    ).toBe("6ad3a201-95b8-83ed-a175-a8007d1a732a");
  });

  it("rejects a URL that is not a chat", () => {
    expect(() => readConversationIdFromOption("https://chatgpt.com/projects")).toThrow(
      "Not a ChatGPT chat id or URL: https://chatgpt.com/projects",
    );
  });
});
