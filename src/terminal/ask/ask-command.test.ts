import { describe, expect, it, vi } from "vitest";
import { applyAskPreflight } from "./ask-command.ts";

type PreflightEngine = Parameters<typeof applyAskPreflight>[0]["engine"];

const createEngineWithOrchestrator = (orchestrator: object): PreflightEngine => {
  return { getOrchestrator: () => orchestrator } as unknown as PreflightEngine;
};

describe("applyAskPreflight", () => {
  it("switches to the requested model", async () => {
    const switchModel = vi.fn().mockResolvedValue("GPT-5");

    await applyAskPreflight({
      engine: createEngineWithOrchestrator({ switchModel }),
      options: { model: "gpt-5" },
    });

    expect(switchModel).toHaveBeenCalledWith("gpt-5");
  });

  it("reports a failed switch with the model and the reason", async () => {
    const switchModel = vi.fn().mockRejectedValue(new Error("The model menu showed: GPT-5."));

    const attempt = applyAskPreflight({
      engine: createEngineWithOrchestrator({ switchModel }),
      options: { model: "o9" },
    });

    await expect(attempt).rejects.toThrow(
      'Could not switch to model "o9": The model menu showed: GPT-5.',
    );
  });

  it("does nothing when no model is requested", async () => {
    const switchModel = vi.fn();

    await applyAskPreflight({ engine: createEngineWithOrchestrator({ switchModel }), options: {} });

    expect(switchModel).not.toHaveBeenCalled();
  });

  it("fails the ask when a fresh conversation cannot open", async () => {
    const openNewConversation = vi.fn().mockRejectedValue(new Error("No composer on the page"));
    const switchModel = vi.fn();

    const attempt = applyAskPreflight({
      engine: createEngineWithOrchestrator({ openNewConversation, switchModel }),
      options: { fresh: true, model: "gpt-5" },
    });

    await expect(attempt).rejects.toThrow(
      "Could not open a new conversation: No composer on the page",
    );
    expect(switchModel).not.toHaveBeenCalled();
  });

  it("fails the ask when the requested conversation cannot open", async () => {
    const conversationUrl = "https://chatgpt.com/c/0b8f0e4a-6c5e-4d8e-9d52-4f2f1f0e2a11";
    const navigateToConversation = vi.fn().mockRejectedValue(new Error("Page did not load"));

    const attempt = applyAskPreflight({
      engine: createEngineWithOrchestrator({ navigateToConversation }),
      options: { conversation: conversationUrl },
    });

    await expect(attempt).rejects.toThrow(
      `Could not open conversation "${conversationUrl}": Page did not load`,
    );
  });

  it("opens a fresh conversation and skips --conversation when both are given", async () => {
    const openNewConversation = vi.fn().mockResolvedValue(undefined);
    const navigateToConversation = vi.fn();
    const conversationUrl = "https://chatgpt.com/c/0b8f0e4a-6c5e-4d8e-9d52-4f2f1f0e2a11";

    await applyAskPreflight({
      engine: createEngineWithOrchestrator({ openNewConversation, navigateToConversation }),
      options: { fresh: true, conversation: conversationUrl },
    });

    expect(openNewConversation).toHaveBeenCalledOnce();
    expect(navigateToConversation).not.toHaveBeenCalled();
  });
});
