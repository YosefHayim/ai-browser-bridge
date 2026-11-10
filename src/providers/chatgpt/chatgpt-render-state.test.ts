import { describe, expect, it } from "vitest";
import { classifyRenderStatus, type UnparsedChatGptRenderStatus } from "./chatgpt-render-state.ts";

const createUnparsedRenderStatus = (
  over: Partial<UnparsedChatGptRenderStatus> = {},
): UnparsedChatGptRenderStatus => ({
  streaming: false,
  assistantTurnCount: 1,
  images: { loaded: 0, pending: 0, total: 0 },
  lastAssistantText: "",
  noticeCandidates: [],
  ...over,
});

describe("classifyRenderState", () => {
  it("flags a misfire when there are no images and the text refuses", () => {
    const status = classifyRenderStatus(
      createUnparsedRenderStatus({
        lastAssistantText:
          "I couldn't generate that; I treated this as an edit and needed an upload target.",
      }),
    );
    expect(status.misfireSuspected).toBe(true);
  });

  it("does not flag a misfire once generated images are present", () => {
    const renderStatus = classifyRenderStatus(
      createUnparsedRenderStatus({
        lastAssistantText: "couldn't generate",
        images: { loaded: 1, pending: 0, total: 1 },
      }),
    );
    expect(renderStatus.misfireSuspected).toBe(false);
  });

  it("detects an image-cap notice from a body toast line", () => {
    const renderStatus = classifyRenderStatus(
      createUnparsedRenderStatus({
        noticeCandidates: ["Some UI", "You've hit the image generation limit — try again later."],
      }),
    );
    expect(renderStatus.limitHit).toBe(true);
    // The earliest-matching alternative wins, so the captured phrase is "You've hit".
    expect(renderStatus.limitNotice).toMatch(/you'?ve hit/i);
  });

  it("detects a limit notice in the assistant text itself", () => {
    const renderStatus = classifyRenderStatus(
      createUnparsedRenderStatus({ lastAssistantText: "I can't create images right now." }),
    );
    expect(renderStatus.limitHit).toBe(true);
    expect(renderStatus.misfireSuspected).toBe(false);
  });

  it("counts [image-N] markers from the assistant text", () => {
    const renderStatus = classifyRenderStatus(
      createUnparsedRenderStatus({
        lastAssistantText: "Here they are [image-1] [image-2] [image-3]",
      }),
    );
    expect(renderStatus.expectedImageMarkers).toBe(3);
  });

  it("reports a clean state for a normal reply", () => {
    const renderStatus = classifyRenderStatus(
      createUnparsedRenderStatus({ lastAssistantText: "Sure, here is the answer." }),
    );
    expect(renderStatus).toMatchObject({
      misfireSuspected: false,
      limitHit: false,
      limitNotice: null,
      expectedImageMarkers: 0,
    });
  });
});
