import { describe, expect, it, vi } from "vitest";
import { makeFakeComposer } from "@/testSupport/fakeComposer.ts";
import {
  geminiProvider,
  injectPrompt,
  isLikelyModelLabel,
  isTurnSettled,
  SELECTORS,
} from "./geminiPage.ts";

describe("gemini-page selectors", () => {
  it("defines stable composer and response selectors", () => {
    expect(SELECTORS.promptInput).toContain("div.ql-editor");
    expect(SELECTORS.sendButton).toContain('button[aria-label="Send message"]');
    expect(SELECTORS.responseBlock).toContain("model-response");
  });
});

describe("gemini isLikelyModelLabel", () => {
  it("matches Gemini model names", () => {
    expect(isLikelyModelLabel("Gemini 2.5 Flash")).toBe(true);
    expect(isLikelyModelLabel("Pro")).toBe(true);
    expect(isLikelyModelLabel("ChatGPT")).toBe(false);
  });
});

describe("gemini isTurnSettled", () => {
  it("settles once text is stable and streaming stopped", () => {
    expect(
      isTurnSettled({
        hasText: true,
        isTransientText: false,
        streaming: false,
        stableForMs: 1_600,
      }),
    ).toBe(true);
  });

  it("does not settle while streaming", () => {
    expect(
      isTurnSettled({
        hasText: true,
        isTransientText: false,
        streaming: true,
        stableForMs: 5_000,
      }),
    ).toBe(false);
  });
});

describe("gemini injectPrompt submission confirmation", () => {
  it("resolves after the composer clears", async () => {
    const composer = makeFakeComposer(1, { sendButtonToken: "Send message" });
    await expect(injectPrompt(composer.page, "hello")).resolves.toBeUndefined();
    expect(composer.fillCount).toBe(1);
  });

  it("throws after 3 attempts when the composer never clears", async () => {
    const composer = makeFakeComposer(Number.POSITIVE_INFINITY, {
      sendButtonToken: "Send message",
    });
    await expect(injectPrompt(composer.page, "hello")).rejects.toThrow(
      "composer never cleared after 3 send attempts",
    );
    expect(composer.fillCount).toBe(3);
  });
});

describe("Gemini attachments", () => {
  it("uses an existing file input without opening the attachment menu", async () => {
    const { page } = makeFakeComposer(1);
    const fileInput = page.locator(SELECTORS.attachmentInput);
    fileInput.count = vi.fn().mockResolvedValue(1);
    fileInput.setInputFiles = vi.fn().mockResolvedValue(undefined);
    fileInput.click = vi.fn();

    await geminiProvider.attachFilesToPrompt(page, ["report.pdf"]);

    expect(fileInput.setInputFiles).toHaveBeenCalledWith(["report.pdf"]);
    expect(fileInput.click).not.toHaveBeenCalled();
  });

  it("opens the attachment menu and waits for its file input before uploading", async () => {
    const { page } = makeFakeComposer(1);
    const attachmentControl = page.locator(SELECTORS.attachmentInput);
    attachmentControl.count = vi.fn().mockResolvedValue(0);
    attachmentControl.isVisible = vi.fn().mockResolvedValue(true);
    attachmentControl.click = vi.fn().mockResolvedValue(undefined);
    attachmentControl.waitFor = vi.fn().mockResolvedValue(undefined);
    attachmentControl.setInputFiles = vi.fn().mockResolvedValue(undefined);

    await geminiProvider.attachFilesToPrompt(page, ["report.pdf"]);

    expect(attachmentControl.click).toHaveBeenCalledOnce();
    expect(attachmentControl.waitFor).toHaveBeenCalledWith({ state: "attached", timeout: 5_000 });
    expect(attachmentControl.setInputFiles).toHaveBeenCalledWith(["report.pdf"]);
  });

  it("fails before uploading when the attachment button is unavailable", async () => {
    const { page } = makeFakeComposer(1);
    const attachmentControl = page.locator(SELECTORS.attachmentInput);
    attachmentControl.count = vi.fn().mockResolvedValue(0);
    attachmentControl.isVisible = vi.fn().mockResolvedValue(false);
    attachmentControl.setInputFiles = vi.fn();

    const upload = geminiProvider.attachFilesToPrompt(page, ["report.pdf"]);

    await expect(upload).rejects.toThrow("Gemini file attachment controls are not available");
    expect(attachmentControl.setInputFiles).not.toHaveBeenCalled();
  });
});
