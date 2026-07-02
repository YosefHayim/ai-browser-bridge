import { describe, expect, it } from "vitest";
import {
  exactName,
  stripConversationId,
} from "../../../src/features/providers/chatgpt/chatgptWorkspace.ts";

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

describe("exactName", () => {
  it("matches the exact name and rejects longer strings", () => {
    const re = exactName("Email Sender");
    expect(re.test("Email Sender")).toBe(true);
    expect(re.test("Email Sender 2")).toBe(false);
    expect(re.test("My Email Sender")).toBe(false);
  });

  it("escapes regex metacharacters in project names", () => {
    const re = exactName("A+B (v2)");
    expect(re.test("A+B (v2)")).toBe(true);
    expect(re.test("AXB (v2)")).toBe(false);
  });
});
