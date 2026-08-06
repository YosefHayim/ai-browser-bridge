import { describe, expect, it } from "vitest";
import { ContextCounter } from "@/features/bridge";
import type { AppProps } from "../shell/appTypes.ts";
import { statusBarProps } from "./statusBarState.ts";

const appProps = (overrides: Partial<AppProps> = {}): AppProps =>
  ({
    config: { permissionMode: "ask" },
    sendMessage: async () => undefined,
    messages: [],
    counter: new ContextCounter(1000),
    orchestrator: {
      listConversations: async () => [],
      searchConversations: async () => [],
      navigateToConversation: async () => undefined,
      newConversation: async () => undefined,
      model: "GPT-5.2",
      detectModel: async () => "GPT-5.2",
      listModels: async () => [],
      switchModel: async () => "GPT-5.2",
      rewindLastPrompt: async () => undefined,
      stopResponse: async () => false,
    },
    ...overrides,
  }) as AppProps;

describe("statusBarProps", () => {
  it("truncates status and model, defaults missing branch and session", () => {
    const counter = new ContextCounter(1000, "GPT-5.2");
    const bar = statusBarProps({
      props: appProps(),
      status: "Waiting for reply now",
      counter,
    });

    expect(bar.shortStatus).toBe("Waiting for r…");
    expect(bar.shortModel.length).toBeLessThanOrEqual(10);
    expect(bar.shortBranch).toBe("nogit");
    expect(bar.displaySessionId).toBe("nosess");
    expect(bar.displayPermissionMode).toBe("ask");
    expect(bar.displayToolCallCount).toBe(0);
    expect(bar.ctxColor).toBe("green");
    expect(bar.ctxPctLabel).toBe("0%");
  });

  it("prefers live permission, statusline, and session sources", () => {
    const counter = new ContextCounter(100);
    counter.add({
      id: "1",
      role: "user",
      content: "a".repeat(400),
      timestamp: 0,
    });

    const bar = statusBarProps({
      props: appProps({
        permissionMode: "ask",
        branch: "fallback",
        toolCallCount: 1,
        sessionId: "fallback-session-id",
        permission: {
          getMode: () => "auto",
          setMode: () => undefined,
        },
        statusline: { branch: "feature/long-name", toolCallCount: () => 7 },
        session: {
          getId: () => "abcdef12-rest-of-id",
          setId: () => undefined,
        },
      }),
      status: "Ready",
      counter,
    });

    expect(bar.displayPermissionMode).toBe("auto");
    expect(bar.displayToolCallCount).toBe(7);
    expect(bar.shortBranch).toBe("feature…");
    expect(bar.displaySessionId).toBe("abcdef12");
    expect(bar.ctxColor).toBe("red");
  });

  it("uses yellow when context usage is between 50% and 80%", () => {
    const counter = new ContextCounter(100);
    counter.add({
      id: "1",
      role: "user",
      content: "a".repeat(220),
      timestamp: 0,
    });

    const bar = statusBarProps({
      props: appProps({ permissionMode: "auto" }),
      status: "Ready",
      counter,
    });

    expect(counter.fraction).toBeGreaterThan(0.5);
    expect(counter.fraction).toBeLessThanOrEqual(0.8);
    expect(bar.ctxColor).toBe("yellow");
  });
});
