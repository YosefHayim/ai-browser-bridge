import type { Page } from "playwright";
import { afterEach, describe, expect, it } from "vitest";
import { readComposerText } from "../../../../src/features/providers/chatgpt/chatgptPage.ts";

/**
 * Regression guard for issue #11: `readComposerText` must hand `page.evaluate`
 * a real **function**, not a string. Playwright silently returns `undefined`
 * for a string snippet, which made the composer look perpetually non-empty and
 * aborted every `bridge ask`.
 *
 * The fake `evaluate` below *invokes the argument it is given* against a stubbed
 * `document`. If the reader regressed to passing a string, calling it would
 * throw "is not a function" and fail the test — the original bug would no
 * longer slip through (unlike the injectPrompt fake, whose `evaluate` ignores
 * its argument entirely).
 */

/** Install a `document.querySelector` stub returning `element` for this case. */
function stubDocument(element: { innerText?: string } | null): void {
  (globalThis as { document?: unknown }).document = {
    querySelector: () => element,
  };
}

/** Page stub whose `evaluate` runs the passed in-page function for real. */
function fakePage(): Page {
  return {
    evaluate: async <Result>(fn: () => Result): Promise<Result> => fn(),
  } as unknown as Page;
}

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
