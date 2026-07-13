import { makeFakeComposer } from "@/testSupport/fakeComposer.ts";
import { describe, expect, it } from "vitest";
import { SELECTORS, injectPrompt, isLikelyModelLabel, isTurnSettled } from "./flowPage.ts";

describe("flow-page selectors", () => {
  it("defines the LIVE-VERIFIED prompt, submit, and clip selectors", () => {
    // Flow's composer is a Slate editor; its submit is the non-menu "Create" button.
    expect(SELECTORS.promptInput).toContain("data-slate-editor");
    expect(SELECTORS.generateButton).toContain("Create");
    expect(SELECTORS.generateButton).toContain(":not([aria-haspopup])");
    expect(SELECTORS.clip).toContain("video");
  });
});

describe("flow isLikelyModelLabel", () => {
  it("matches Veo model and quality names", () => {
    expect(isLikelyModelLabel("Veo 3.1")).toBe(true);
    expect(isLikelyModelLabel("Quality")).toBe(true);
    expect(isLikelyModelLabel("ChatGPT")).toBe(false);
  });
});

describe("flow isTurnSettled", () => {
  it("settles once a clip is present and generation stopped", () => {
    expect(isTurnSettled({ hasClip: true, generating: false, stableForMs: 2_500 })).toBe(true);
  });

  it("does not settle while still generating", () => {
    expect(isTurnSettled({ hasClip: true, generating: true, stableForMs: 9_000 })).toBe(false);
  });

  it("does not settle before the quiet window elapses", () => {
    expect(isTurnSettled({ hasClip: true, generating: false, stableForMs: 500 })).toBe(false);
  });
});

describe("flow injectPrompt submission confirmation", () => {
  it("resolves after the composer clears", async () => {
    const composer = makeFakeComposer(1, { sendButtonToken: "Create" });
    await expect(injectPrompt(composer.page, "a cat surfing")).resolves.toBeUndefined();
    expect(composer.fillCount).toBe(1);
  });

  it("throws after 3 attempts when the composer never clears", async () => {
    const composer = makeFakeComposer(Number.POSITIVE_INFINITY, { sendButtonToken: "Create" });
    await expect(injectPrompt(composer.page, "a cat surfing")).rejects.toThrow(
      "composer never cleared after 3 send attempts",
    );
    expect(composer.fillCount).toBe(3);
  });
});
