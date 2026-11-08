import type { Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launchFixtureBrowser, openFixturePage } from "@/testSupport/chromiumFixturePage.ts";
import { readComposerText } from "./chatgptPage.ts";

let browser: Browser;

beforeAll(async () => {
  browser = await launchFixtureBrowser();
}, 60_000);

afterAll(async () => {
  await browser.close();
});

describe("readComposerText", () => {
  it("returns the trimmed text of the rendered composer when a hidden copy comes first", async () => {
    const page = await openFixturePage({
      browser,
      html: `
        <div style="display: none">
          <div class="ProseMirror" contenteditable="true" aria-label="Ask ChatGPT">stale hidden draft</div>
        </div>
        <div class="ProseMirror" contenteditable="true" aria-label="Ask ChatGPT">  draft prompt  </div>
      `,
    });

    expect(await readComposerText({ page })).toBe("draft prompt");
  });

  it("returns an empty string when only a hidden composer exists", async () => {
    const page = await openFixturePage({
      browser,
      html: `
        <div style="display: none">
          <div class="ProseMirror" contenteditable="true" aria-label="Ask ChatGPT">stale hidden draft</div>
        </div>
      `,
    });

    expect(await readComposerText({ page })).toBe("");
  });
});
