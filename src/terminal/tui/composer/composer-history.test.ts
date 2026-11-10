import { describe, expect, it } from "vitest";
import {
  addPrompt,
  createPromptHistory,
  listPrompts,
  reverseHistorySearch,
  reverseSearchQuery,
  stepToNextPrompt,
  stepToPreviousPrompt,
} from "./composer-history.ts";

describe("PromptHistory", () => {
  it("stores non-empty prompts newest-last with consecutive duplicates collapsed", () => {
    const submittedPrompts = [
      "  first prompt  ",
      "",
      "second prompt",
      "second prompt",
      "third prompt",
      "fourth prompt",
    ];

    const history = submittedPrompts.reduce(addPrompt, createPromptHistory([], { limit: 3 }));

    expect(listPrompts(history)).toEqual(["second prompt", "third prompt", "fourth prompt"]);
  });

  it("navigates older and newer prompts from the current draft", () => {
    const history = createPromptHistory(["first", "second"]);

    const firstStep = stepToPreviousPrompt(history, "draft");
    const secondStep = stepToPreviousPrompt(firstStep.history, "ignored once browsing");
    const thirdStep = stepToPreviousPrompt(secondStep.history, "ignored at oldest");
    const fourthStep = stepToNextPrompt(thirdStep.history);
    const fifthStep = stepToNextPrompt(fourthStep.history);
    const sixthStep = stepToNextPrompt(fifthStep.history);

    expect(firstStep.prompt).toBe("second");
    expect(secondStep.prompt).toBe("first");
    expect(thirdStep.prompt).toBe("first");
    expect(fourthStep.prompt).toBe("second");
    expect(fifthStep.prompt).toBe("draft");
    expect(sixthStep.prompt).toBe("draft");
  });

  it("resets browsing when a new prompt is added", () => {
    const history = createPromptHistory(["first"]);

    const browsingStep = stepToPreviousPrompt(history, "draft");
    const historyWithSecond = addPrompt(browsingStep.history, "second");
    const nextStep = stepToNextPrompt(historyWithSecond);
    const previousStep = stepToPreviousPrompt(nextStep.history, "fresh draft");

    expect(browsingStep.prompt).toBe("first");
    expect(nextStep.prompt).toBe("");
    expect(previousStep.prompt).toBe("second");
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
