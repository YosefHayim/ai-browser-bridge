import { describe, expect, it } from "vitest";
import { formatDownloadLine, parseAttachmentIds } from "../../src/cli/headless.ts";

describe("parseAttachmentIds", () => {
  it("returns undefined when no values are given", () => {
    expect(parseAttachmentIds(undefined)).toBeUndefined();
  });

  it("flattens comma-separated values into a flat id list", () => {
    expect(parseAttachmentIds(["a", "b,c"])).toEqual(["a", "b", "c"]);
  });

  it("returns undefined when only blank values remain", () => {
    expect(parseAttachmentIds(["  "])).toBeUndefined();
  });

  it("trims whitespace around comma-separated ids", () => {
    expect(parseAttachmentIds(["a, b"])).toEqual(["a", "b"]);
  });
});

describe("formatDownloadLine", () => {
  it("formats a successful download with path and size", () => {
    expect(formatDownloadLine({ id: "image-1", path: "/tmp/image-1.png", bytes: 12345 })).toBe(
      "image-1 -> /tmp/image-1.png (12345 bytes)",
    );
  });

  it("formats a failed download with its error message", () => {
    expect(formatDownloadLine({ id: "image-1", path: "", bytes: 0, error: "not found" })).toBe(
      "image-1: not found",
    );
  });
});
