import type { Browser, Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launchFixtureBrowser, openFixturePage } from "@/testing/chromium-fixture-page.ts";
import { makeFakeComposer } from "@/testing/fake-composer.ts";
import { injectPrompt } from "./chatgpt-page.ts";

// How the fixture ChatGPT reacts to a send click.
type SendBehavior = "clearsAfterUpload" | "keepsDraft" | "streams";

const uploadTakesMilliseconds = 8_000;
const streamingTakesMilliseconds = 3_000;
const BROWSER_TEST_TIMEOUT_MILLISECONDS = 90_000;

// The hidden workspace send button comes first in the DOM, like the real page.
const chatFixtureHtml = (sendBehavior: SendBehavior): string => `
  <div style="display: none">
    <form data-chatgpt-composer>
      <div class="ProseMirror" contenteditable="true" aria-label="Ask ChatGPT"></div>
      <button aria-label="Send">hidden send</button>
    </form>
  </div>
  <form>
    <div id="thread"></div>
    <div id="composer" class="ProseMirror" contenteditable="true" aria-label="Ask ChatGPT"></div>
    <button id="send" aria-label="Send">Send</button>
  </form>
  <script>
    const sendBehavior = ${JSON.stringify(sendBehavior)};
    const composer = document.getElementById("composer");
    const thread = document.getElementById("thread");
    const recordSend = () => {
      document.body.dataset.sends = String(Number(document.body.dataset.sends ?? "0") + 1);
    };
    const appendUserTurn = (prompt) => {
      const userTurn = document.createElement("div");
      userTurn.setAttribute("data-message-author-role", "user");
      userTurn.textContent = prompt;
      thread.appendChild(userTurn);
    };
    const showStopButton = () => {
      const stopButton = document.createElement("button");
      stopButton.setAttribute("aria-label", "Stop generating");
      document.body.appendChild(stopButton);
      setTimeout(() => stopButton.remove(), ${streamingTakesMilliseconds});
    };
    const sendPrompt = () => {
      recordSend();
      const prompt = composer.textContent;
      if (sendBehavior === "clearsAfterUpload") {
        setTimeout(() => {
          appendUserTurn(prompt);
          composer.textContent = "";
        }, ${uploadTakesMilliseconds});
      }
      if (sendBehavior === "keepsDraft") appendUserTurn(prompt);
      if (sendBehavior === "streams") showStopButton();
    };
    document.getElementById("send").addEventListener("click", (event) => {
      event.preventDefault();
      sendPrompt();
    });
    composer.addEventListener("keydown", (event) => {
      if (event.key === "Enter") sendPrompt();
    });
  </script>
`;

const readRecordedSendCount = async (page: Page): Promise<string | null> => {
  return page.locator("body").getAttribute("data-sends");
};

let browser: Browser;

beforeAll(async () => {
  browser = await launchFixtureBrowser();
}, 60_000);

afterAll(async () => {
  await browser.close();
});

describe("injectPrompt", () => {
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

  it("throws after 3 attempts when no send is ever confirmed", async () => {
    const composer = makeFakeComposer(Number.POSITIVE_INFINITY);

    await expect(injectPrompt(composer.page, "hello")).rejects.toThrow(
      "no send was confirmed after 3 attempts",
    );
    expect(composer.fillCount).toBe(3);
  });

  it(
    "sends once when the composer empties only after an attachment upload",
    async () => {
      const page = await openFixturePage({ browser, html: chatFixtureHtml("clearsAfterUpload") });

      await expect(injectPrompt(page, "draw a cat")).resolves.toBeUndefined();

      expect(await readRecordedSendCount(page)).toBe("1");
    },
    BROWSER_TEST_TIMEOUT_MILLISECONDS,
  );

  it(
    "sends once when a new user turn appears but the draft stays in the composer",
    async () => {
      const page = await openFixturePage({ browser, html: chatFixtureHtml("keepsDraft") });

      await expect(injectPrompt(page, "draw a dog")).resolves.toBeUndefined();

      expect(await readRecordedSendCount(page)).toBe("1");
    },
    BROWSER_TEST_TIMEOUT_MILLISECONDS,
  );

  it(
    "sends once when a reply starts streaming but the draft stays in the composer",
    async () => {
      const page = await openFixturePage({ browser, html: chatFixtureHtml("streams") });

      await expect(injectPrompt(page, "draw a bird")).resolves.toBeUndefined();

      expect(await readRecordedSendCount(page)).toBe("1");
    },
    BROWSER_TEST_TIMEOUT_MILLISECONDS,
  );
});
