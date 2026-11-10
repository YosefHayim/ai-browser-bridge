import { describe, expect, it } from "vitest";
import {
  addPrompt,
  createPromptHistory,
  listPrompts,
  readNextPrompt,
  readPreviousPrompt,
  reverseHistorySearch,
  reverseSearchQuery,
} from "./composer-history.ts";

describe("PromptHistory", () => {
  it("stores non-empty prompts newest-last with consecutive duplicates collapsed", () => {
    const history = createPromptHistory([], { limit: 3 });

    addPrompt(history, "  first prompt  ");
    addPrompt(history, "");
    addPrompt(history, "second prompt");
    addPrompt(history, "second prompt");
    addPrompt(history, "third prompt");
    addPrompt(history, "fourth prompt");

    expect(listPrompts(history)).toEqual(["second prompt", "third prompt", "fourth prompt"]);
  });

  it("navigates older and newer prompts from the current draft", () => {
    const history = createPromptHistory(["first", "second"]);

    expect(readPreviousPrompt(history, "draft")).toBe("second");
    expect(readPreviousPrompt(history, "ignored once browsing")).toBe("first");
    expect(readPreviousPrompt(history, "ignored at oldest")).toBe("first");
    expect(readNextPrompt(history)).toBe("second");
    expect(readNextPrompt(history)).toBe("draft");
    expect(readNextPrompt(history)).toBe("draft");
  });

  it("resets browsing when a new prompt is added", () => {
    const history = createPromptHistory(["first"]);

    expect(readPreviousPrompt(history, "draft")).toBe("first");
    addPrompt(history, "second");

    expect(readNextPrompt(history)).toBe("");
    expect(readPreviousPrompt(history, "fresh draft")).toBe("second");
  });
});

describe("reverse search helpers", () => {
  it("extracts the query after the last Ctrl+R marker", () => {
    expect(reverseSearchQuery("prefix \u0012model")).toBe("model");
    expect(reverseSearchQuery("plain text")).toBeNull();
  });

  it("finds the newest matching history entry", () => {
    expect(reverseHistorySearch(["ask model", "inspect files", "switch model"], "model")).toBe(
      "switch model",
    );
    expect(reverseHistorySearch(["ask model"], "missing")).toBeNull();
    expect(reverseHistorySearch(["ask model"], "")).toBe("ask model");
  });
});
