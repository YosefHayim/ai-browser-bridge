import { describe, expect, it } from "vitest";
import { PromptHistory, reverseHistorySearch, reverseSearchQuery } from "./composer-history.ts";

describe("PromptHistory", () => {
  it("stores non-empty prompts newest-last with consecutive duplicates collapsed", () => {
    const history = new PromptHistory([], { limit: 3 });

    history.add("  first prompt  ");
    history.add("");
    history.add("second prompt");
    history.add("second prompt");
    history.add("third prompt");
    history.add("fourth prompt");

    expect(history.listPrompts()).toEqual(["second prompt", "third prompt", "fourth prompt"]);
  });

  it("navigates older and newer prompts from the current draft", () => {
    const history = new PromptHistory(["first", "second"]);

    expect(history.readPreviousPrompt("draft")).toBe("second");
    expect(history.readPreviousPrompt("ignored once browsing")).toBe("first");
    expect(history.readPreviousPrompt("ignored at oldest")).toBe("first");
    expect(history.readNextPrompt()).toBe("second");
    expect(history.readNextPrompt()).toBe("draft");
    expect(history.readNextPrompt()).toBe("draft");
  });

  it("resets browsing when a new prompt is added", () => {
    const history = new PromptHistory(["first"]);

    expect(history.readPreviousPrompt("draft")).toBe("first");
    history.add("second");

    expect(history.readNextPrompt()).toBe("");
    expect(history.readPreviousPrompt("fresh draft")).toBe("second");
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
