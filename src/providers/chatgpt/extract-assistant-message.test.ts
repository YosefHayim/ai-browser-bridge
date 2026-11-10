import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launchFixtureBrowser, openFixturePage } from "@/testing/chromium-fixture-page.ts";
import { extractAssistantMessage } from "./chatgpt-page.ts";

let browser: Browser;
let manifestRoot: string;

beforeAll(async () => {
  browser = await launchFixtureBrowser();
  manifestRoot = await mkdtemp(join(tmpdir(), "chatgpt-reply-test-"));
}, 60_000);

afterAll(async () => {
  await browser.close();
  await rm(manifestRoot, { recursive: true, force: true });
});

describe("extractAssistantMessage", () => {
  it("returns the text of the last assistant turn when the turn has a role block", async () => {
    const page = await openFixturePage({
      browser,
      html: `
        <section data-testid="conversation-turn-1">
          <div data-message-author-role="user">Say ready</div>
        </section>
        <section data-testid="conversation-turn-2">
          <div data-message-author-role="assistant">ready</div>
        </section>
      `,
    });

    const reply = await extractAssistantMessage(page, {
      conversationId: "fixture-reply",
      manifestRoot,
    });

    expect(reply.text).toBe("ready");
  });

  it("returns an empty text when the page holds no assistant turn", async () => {
    const page = await openFixturePage({
      browser,
      html: `
        <section data-testid="conversation-turn-1">
          <div data-message-author-role="user">Say ready</div>
        </section>
      `,
    });

    const reply = await extractAssistantMessage(page, {
      conversationId: "fixture-no-reply",
      manifestRoot,
    });

    expect(reply.text).toBe("");
  });
});
