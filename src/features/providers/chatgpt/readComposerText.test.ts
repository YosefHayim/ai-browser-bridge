import type { Page } from "playwright";
import { afterEach, describe, expect, it } from "vitest";
import { readComposerText } from "./chatgptPage.ts";

// Regression guard for issue #11: readComposerText must pass page.evaluate a real
// callback, not a string. Playwright silently returns undefined for a string snippet,
// which made the composer look perpetually non-empty and aborted every bridge ask.
// The fake evaluate invokes its argument against a stubbed document so a string
// regression throws not-callable instead of slipping through.

const stubDocument = (element: { innerText?: string } | null): void => {
  (globalThis as { document?: unknown }).document = {
    querySelector: () => element,
  };
};

const fakePage = (): Page => {
  return {
    evaluate: async <Result>(fn: () => Result): Promise<Result> => fn(),
  } as unknown as Page;
};

afterEach(() => {
  (globalThis as { document?: unknown }).document = undefined;
});

describe("readComposerText", () => {
  it("returns the trimmed innerText when the composer has content", async () => {
    stubDocument({ innerText: "  draft prompt  " });
    expect(await readComposerText({ page: fakePage() })).toBe("draft prompt");
  });

  it("returns an empty string when the composer element is absent", async () => {
    stubDocument(null);
    expect(await readComposerText({ page: fakePage() })).toBe("");
  });

  it("coerces an undefined innerText to an empty string", async () => {
    stubDocument({ innerText: undefined });
    expect(await readComposerText({ page: fakePage() })).toBe("");
  });
});
