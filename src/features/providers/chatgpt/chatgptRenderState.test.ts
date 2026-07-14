import { describe, expect, it } from "vitest";
import { type RawChatGptRenderState, classifyRenderState } from "./chatgptRenderState.ts";

/** Build a raw render-state snapshot with clean defaults, overriding only what a test needs. */
const raw = (over: Partial<RawChatGptRenderState> = {}): RawChatGptRenderState => ({
  streaming: false,
  assistantTurnCount: 1,
  images: { loaded: 0, pending: 0, total: 0 },
  lastAssistantText: "",
  noticeCandidates: [],
  ...over,
});

describe("classifyRenderState", () => {
  it("flags a misfire when there are no images and the text refuses", () => {
    const state = classifyRenderState(
      raw({
        lastAssistantText:
          "I couldn't generate that; I treated this as an edit and needed an upload target.",
      }),
    );
    expect(state.misfireSuspected).toBe(true);
  });

  it("does not flag a misfire once generated images are present", () => {
    const state = classifyRenderState(
      raw({ lastAssistantText: "couldn't generate", images: { loaded: 1, pending: 0, total: 1 } }),
    );
    expect(state.misfireSuspected).toBe(false);
  });

  it("detects an image-cap notice from a body toast line", () => {
    const state = classifyRenderState(
      raw({
        noticeCandidates: ["Some UI", "You've hit the image generation limit — try again later."],
      }),
    );
    expect(state.limitHit).toBe(true);
    // The earliest-matching alternative wins, so the captured phrase is "You've hit".
    expect(state.limitNotice).toMatch(/you'?ve hit/i);
  });

  it("detects a limit notice in the assistant text itself", () => {
    const state = classifyRenderState(
      raw({ lastAssistantText: "I can't create images right now." }),
    );
    expect(state.limitHit).toBe(true);
    expect(state.misfireSuspected).toBe(false);
  });

  it("counts [image-N] markers from the assistant text", () => {
    const state = classifyRenderState(
      raw({ lastAssistantText: "Here they are [image-1] [image-2] [image-3]" }),
    );
    expect(state.expectedImageMarkers).toBe(3);
  });

  it("reports a clean state for a normal reply", () => {
    const state = classifyRenderState(raw({ lastAssistantText: "Sure, here is the answer." }));
    expect(state).toMatchObject({
      misfireSuspected: false,
      limitHit: false,
      limitNotice: null,
      expectedImageMarkers: 0,
    });
  });
});
