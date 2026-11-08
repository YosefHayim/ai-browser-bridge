import type { Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launchFixtureBrowser, openFixturePage } from "@/testSupport/chromiumFixturePage.ts";
import { findVisibleComposer, removeComposerAttachments } from "./chatgptComposer.ts";

// ChatGPT renders a hidden workspace copy of the composer before the real one.
const composerWithHiddenCopyFirst = `
  <div style="display: none">
    <form data-chatgpt-composer>
      <div id="hidden-composer" class="ProseMirror" contenteditable="true" aria-label="Ask ChatGPT"></div>
    </form>
  </div>
  <form>
    <div id="visible-composer" class="ProseMirror" contenteditable="true" aria-label="Ask ChatGPT"></div>
  </form>
`;

const composerWithAttachments = `
  <div style="display: none">
    <form>
      <button aria-label="Remove hidden-copy.png"></button>
    </form>
  </div>
  <style>
    [class~="group/composer-attachment"] button { pointer-events: none; }
    [class~="group/composer-attachment"]:hover button { pointer-events: auto; }
  </style>
  <form>
    <div id="attachments">
      <div class="group/composer-attachment"><button aria-label="Remove look-a.png" onclick="this.parentElement.remove()"></button></div>
      <div class="group/composer-attachment"><button aria-label="Remove look-b.png" onclick="this.parentElement.remove()"></button></div>
      <div class="group/composer-attachment"><button aria-label="Remove look-c.png" onclick="this.parentElement.remove()"></button></div>
      <div class="group/composer-attachment"><button aria-label="Remove look-d.png" onclick="this.parentElement.remove()"></button></div>
    </div>
    <div class="ProseMirror" contenteditable="true" aria-label="Ask ChatGPT"></div>
  </form>
`;

let browser: Browser;

beforeAll(async () => {
  browser = await launchFixtureBrowser();
}, 60_000);

afterAll(async () => {
  await browser.close();
});

describe("findVisibleComposer", () => {
  it("types into the rendered composer when a hidden copy comes first", async () => {
    const page = await openFixturePage({ browser, html: composerWithHiddenCopyFirst });

    await findVisibleComposer(page).fill("typed prompt");

    expect(await page.locator("#visible-composer").textContent()).toBe("typed prompt");
    expect(await page.locator("#hidden-composer").textContent()).toBe("");
  });
});

describe("removeComposerAttachments", () => {
  it("removes every attached file chip from the rendered composer", async () => {
    const page = await openFixturePage({ browser, html: composerWithAttachments });

    await removeComposerAttachments(page);

    expect(await page.locator("#attachments button").count()).toBe(0);
  });

  it("leaves a composer without attachments unchanged", async () => {
    const page = await openFixturePage({ browser, html: composerWithHiddenCopyFirst });

    await removeComposerAttachments(page);

    expect(await page.locator("#visible-composer").textContent()).toBe("");
  });
});
