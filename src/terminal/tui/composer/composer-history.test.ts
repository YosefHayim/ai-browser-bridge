import { describe, expect, it } from "vitest";
import {
  addPrompt,
  createPromptHistory,
  listPrompts,
  pickNextPromptStep,
  pickPreviousPromptStep,
  reverseHistorySearch,
  reverseSearchQuery,
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

    const firstStep = pickPreviousPromptStep(history, "draft");
    const secondStep = pickPreviousPromptStep(firstStep.history, "ignored once browsing");
    const thirdStep = pickPreviousPromptStep(secondStep.history, "ignored at oldest");
    const fourthStep = pickNextPromptStep(thirdStep.history);
    const fifthStep = pickNextPromptStep(fourthStep.history);
    const sixthStep = pickNextPromptStep(fifthStep.history);

    expect(firstStep.prompt).toBe("second");
    expect(secondStep.prompt).toBe("first");
    expect(thirdStep.prompt).toBe("first");
    expect(fourthStep.prompt).toBe("second");
    expect(fifthStep.prompt).toBe("draft");
    expect(sixthStep.prompt).toBe("draft");
  });

  it("resets browsing when a new prompt is added", () => {
    const history = createPromptHistory(["first"]);

    const browsingStep = pickPreviousPromptStep(history, "draft");
    const historyWithSecond = addPrompt(browsingStep.history, "second");
    const nextStep = pickNextPromptStep(historyWithSecond);
    const previousStep = pickPreviousPromptStep(nextStep.history, "fresh draft");

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
