import { describe, expect, it } from "vitest";
import { PromptHistory, reverseHistoryMatch, reverseSearchQuery } from "./composerHistory.ts";

describe("PromptHistory", () => {
  it("stores non-empty prompts newest-last with consecutive duplicates collapsed", () => {
    const history = new PromptHistory([], { limit: 3 });

    history.add("  first prompt  ");
    history.add("");
    history.add("second prompt");
    history.add("second prompt");
    history.add("third prompt");
    history.add("fourth prompt");

    expect(history.entries()).toEqual(["second prompt", "third prompt", "fourth prompt"]);
  });

  it("navigates older and newer prompts from the current draft", () => {
    const history = new PromptHistory(["first", "second"]);

    expect(history.previous("draft")).toBe("second");
    expect(history.previous("ignored once browsing")).toBe("first");
    expect(history.previous("ignored at oldest")).toBe("first");
    expect(history.next()).toBe("second");
    expect(history.next()).toBe("draft");
    expect(history.next()).toBe("draft");
  });

  it("resets browsing when a new prompt is added", () => {
    const history = new PromptHistory(["first"]);

    expect(history.previous("draft")).toBe("first");
    history.add("second");

    expect(history.next()).toBe("");
    expect(history.previous("fresh draft")).toBe("second");
  });
});

describe("reverse search helpers", () => {
  it("extracts the query after the last Ctrl+R marker", () => {
    expect(reverseSearchQuery("prefix \u0012model")).toBe("model");
    expect(reverseSearchQuery("plain text")).toBeUndefined();
  });

  it("finds the newest matching history entry", () => {
    expect(reverseHistoryMatch(["ask model", "inspect files", "switch model"], "model")).toBe(
      "switch model",
    );
    expect(reverseHistoryMatch(["ask model"], "missing")).toBeUndefined();
    expect(reverseHistoryMatch(["ask model"], "")).toBe("ask model");
  });
});
