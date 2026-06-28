import { describe, it, expect } from "vitest";
import { estimateTokens, ContextCounter } from "../../../src/features/bridge/bridge-engine.class.ts";

describe("estimateTokens", () => {
  it("estimates tokens from string length", () => {
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });

  it("returns at least 1 for non-empty strings", () => {
    expect(estimateTokens("x")).toBe(1);
  });
});

describe("ContextCounter", () => {
  it("tracks message tokens", () => {
    const counter = new ContextCounter(1000);
    counter.add({ id: "1", role: "user", content: "a".repeat(400), timestamp: 0 });
    expect(counter.count).toBe(104);
  });

  it("reports fraction correctly", () => {
    const counter = new ContextCounter(1000);
    counter.add({ id: "1", role: "user", content: "a".repeat(400), timestamp: 0 });
    expect(counter.fraction).toBe(0.104);
  });

  it("detects near-limit usage", () => {
    const counter = new ContextCounter(100);
    counter.add({ id: "1", role: "user", content: "a".repeat(400), timestamp: 0 });
    expect(counter.isNearLimit).toBe(true);
  });

  it("resets count", () => {
    const counter = new ContextCounter(1000);
    counter.add({ id: "1", role: "user", content: "hello", timestamp: 0 });
    counter.reset();
    expect(counter.count).toBe(0);
  });

  it("uses model profiles for context limits", () => {
    const counter = new ContextCounter(1000);
    counter.setModel("GPT-5.2");
    expect(counter.contextLimit).toBe(128_000);
    expect(counter.modelLabel).toBe("GPT-5.2 Chat");
  });

  it("keeps ChatGPT browser model labels distinct", () => {
    const counter = new ContextCounter(1000);
    counter.setModel("GPT-5.5 Pro");
    expect(counter.contextLimit).toBe(128_000);
    expect(counter.modelLabel).toBe("GPT-5.5 Pro");
  });

  it("does not map generic ChatGPT to a specific model", () => {
    const counter = new ContextCounter(1000);
    counter.setModel("ChatGPT");
    expect(counter.contextLimit).toBe(128_000);
    expect(counter.modelLabel).toBe("ChatGPT");
  });
});
