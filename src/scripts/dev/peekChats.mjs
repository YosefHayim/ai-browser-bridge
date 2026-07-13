#!/usr/bin/env node
// Dev-only recon: for each conversation id in a JSON array file, open it and print the first user
// message (truncated) so chats with generic titles can be classified by their actual content.
//
//   node src/scripts/dev/peekChats.mjs /tmp/design.json
//
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const CDP_URL = "http://127.0.0.1:9222";
const FILE = process.argv[2] || "/tmp/design.json";
const chats = JSON.parse(readFileSync(FILE, "utf8"));

const firstUserMessage = (page) =>
  page.evaluate(() => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const el = document.querySelector('[data-message-author-role="user"]');
    return el ? norm(el.textContent).slice(0, 200) : "";
  });

const main = async () => {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  let page = context.pages().find((p) => p.url().includes("chatgpt.com"));
  if (!page) page = await context.newPage();
  await page.bringToFront();

  for (const chat of chats) {
    await page.goto(`https://chatgpt.com/c/${chat.id}`, { waitUntil: "domcontentloaded" });
    await page
      .waitForSelector('[data-message-author-role="user"]', { timeout: 8_000 })
      .catch(() => {});
    const msg = await firstUserMessage(page);
    console.log(`${chat.id.slice(0, 8)} | ${chat.title} :: ${msg}`);
  }
  await browser.close();
};

await main();
