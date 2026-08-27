import { describe, expect, it } from "vitest";
import {
  chatGptProjectNameFromConversationAriaLabel,
  chatGptProjectRemovalState,
  exactName,
  projectNameFromDirectoryRowText,
  stripConversationId,
} from "./chatgptWorkspace.ts";

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

describe("chatGptProjectRemovalState", () => {
  it("only confirms the requested project from its named removal action", () => {
    expect(chatGptProjectRemovalState(true, false)).toBe("already-filed");
    expect(chatGptProjectRemovalState(false, true)).toBe("current-project-unknown");
    expect(chatGptProjectRemovalState(false, false)).toBe("not-filed");
  });
});

describe("chatGptProjectNameFromConversationAriaLabel", () => {
  it("reads the current Project from a project-owned Conversation link", () => {
    expect(
      chatGptProjectNameFromConversationAriaLabel(
        "Morning routine notes, chat in project Yoga App",
      ),
    ).toBe("Yoga App");
  });

  it("does not infer a Project from a regular Conversation label", () => {
    expect(chatGptProjectNameFromConversationAriaLabel("Morning routine notes")).toBeNull();
  });
});

describe("projectNameFromDirectoryRowText", () => {
  it("reads the project name from ChatGPT's current directory row", () => {
    expect(projectNameFromDirectoryRowText("Yoga App\nToday")).toBe("Yoga App");
  });

  it("ignores the Projects directory header", () => {
    expect(projectNameFromDirectoryRowText("Name\nModified")).toBeNull();
  });
});
