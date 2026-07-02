import { describe, expect, it } from "vitest";
import { injectPrompt } from "../../../../src/features/providers/chatgpt/chatgptPage.ts";
import { makeFakeComposer } from "../../../support/fakeComposer.ts";

describe("injectPrompt submission confirmation", () => {
  it("resolves after a single send when the composer clears on attempt 1", async () => {
    const composer = makeFakeComposer(1);

    await expect(injectPrompt(composer.page, "hello")).resolves.toBeUndefined();
    expect(composer.fillCount).toBe(1);
    expect(composer.sendClickCount).toBe(1);
  });

  it("re-fills and re-sends when attempt 1 stays full and attempt 2 clears", async () => {
    const composer = makeFakeComposer(2);

    await expect(injectPrompt(composer.page, "hello")).resolves.toBeUndefined();
    expect(composer.fillCount).toBe(2);
    expect(composer.sendClickCount).toBe(2);
  });

  it("throws after 3 attempts when the composer never clears", async () => {
    const composer = makeFakeComposer(Number.POSITIVE_INFINITY);

    await expect(injectPrompt(composer.page, "hello")).rejects.toThrow(
      "composer never cleared after 3 send attempts",
    );
    expect(composer.fillCount).toBe(3);
  });
});
