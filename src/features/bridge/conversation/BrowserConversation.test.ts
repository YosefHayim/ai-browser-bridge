import { describe, expect, it, vi } from "vitest";
import { webProviderFor } from "@/features/webProviders/providerRegistry.ts";
import { makeFakeComposer } from "@/testSupport/fakeComposer.ts";
import type { BridgeConfig } from "../engine/bridgeEngineTypes.ts";
import { BrowserConversation, type BrowserConversationEvent } from "./BrowserConversation.ts";

const conversationConfig: BridgeConfig = {
  repoPath: "/example",
  provider: "chatgpt",
  mcpPort: 3333,
  contextLimit: 128_000,
};

describe("BrowserConversation", () => {
  it("captures a new reply after submitting the prompt and waiting against the old reply", async () => {
    const composer = makeFakeComposer(1);
    const captureLastResponse = vi
      .fn()
      .mockResolvedValueOnce("Previous reply")
      .mockResolvedValueOnce("New reply");
    const injectPrompt = vi.fn().mockResolvedValue(undefined);
    const waitForResponse = vi.fn().mockResolvedValue(undefined);
    const provider = {
      ...webProviderFor("chatgpt"),
      detectCurrentModel: async () => "GPT-5.5 Pro",
      countAssistantResponses: async () => 3,
      captureLastResponse,
      injectPrompt,
      waitForResponse,
    };
    const conversation = new BrowserConversation(conversationConfig, provider);
    const events: BrowserConversationEvent[] = [];
    conversation.on((event) => events.push(event));
    conversation.setPage(composer.page);

    const reply = await conversation.sendPrompt({
      content: "Next question",
      timeoutMs: 1200,
      expectImages: 2,
    });

    expect(injectPrompt).toHaveBeenCalledWith(composer.page, "Next question");
    expect(waitForResponse).toHaveBeenCalledWith(composer.page, {
      previousAssistantCount: 3,
      previousLastAssistantText: "Previous reply",
      timeout: 1200,
      expectImages: 2,
    });
    expect(reply?.content).toBe("New reply");
    expect(conversation.currentMessages.map((message) => message.content)).toEqual([
      "Next question",
      "New reply",
    ]);
    expect(
      events.filter((event) => event.type === "message").map((event) => event.message.role),
    ).toEqual(["user", "assistant"]);
  });

  it("reports a provider failure without recording an assistant reply", async () => {
    const composer = makeFakeComposer(1);
    const provider = {
      ...webProviderFor("chatgpt"),
      detectCurrentModel: async () => "GPT-5.5 Pro",
      countAssistantResponses: async () => 0,
      captureLastResponse: async () => "",
      injectPrompt: async () => {
        throw new Error("Composer unavailable");
      },
    };
    const conversation = new BrowserConversation(conversationConfig, provider);
    const events: BrowserConversationEvent[] = [];
    conversation.on((event) => events.push(event));
    conversation.setPage(composer.page);

    const reply = await conversation.sendPrompt({ content: "Question" });

    expect(reply).toBeNull();
    expect(conversation.currentMessages).toHaveLength(1);
    expect(events).toContainEqual({ type: "error", error: "Composer unavailable" });
  });

  it("reports a missing browser and lets listeners unsubscribe", async () => {
    const conversation = new BrowserConversation(conversationConfig);
    const listener = vi.fn();
    const unsubscribe = conversation.on(listener);

    const reply = await conversation.sendPrompt({ content: "Question" });

    expect(reply).toBeNull();
    expect(listener).toHaveBeenCalledWith({
      type: "error",
      error: "Browser not connected. Cannot send prompt.",
    });
    unsubscribe();
    listener.mockClear();
    await conversation.stop();
    expect(listener).not.toHaveBeenCalled();
  });

  it("filters unsupported and empty captured messages while preserving the original content", async () => {
    const composer = makeFakeComposer(1);
    const provider = {
      ...webProviderFor("chatgpt"),
      detectCurrentModel: async () => "GPT-5.5 Pro",
      captureAllMessages: async () => [
        { role: "system", content: "Hidden instructions" },
        { role: "user", content: "  Question  " },
        { role: "assistant", content: "  " },
        { role: "assistant", content: "Answer" },
      ],
    };
    const conversation = new BrowserConversation(conversationConfig, provider);
    conversation.setPage(composer.page);

    await conversation.start();

    expect(conversation.currentMessages.map((message) => message.content)).toEqual([
      "  Question  ",
      "Answer",
    ]);
  });
});
