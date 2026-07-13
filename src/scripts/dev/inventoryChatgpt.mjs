#!/usr/bin/env node
// Dev-only recon: scroll the ChatGPT sidebar to load all conversations, then inventory each as
// {id, title, project} using the row anchor's aria-label ("<title>" when loose, or
// "<title>, chat in project <Project>" when filed). Attaches to the warm bridge Chrome (:9222).
// Read-only. Prints a JSON array to stdout and a per-project tally to stderr.
//
//   node src/scripts/dev/inventoryChatgpt.mjs
//
import { chromium } from "playwright";

const CDP_URL = "http://127.0.0.1:9222";

const scrape = (page) =>
  page.evaluate(() => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const out = [];
    for (const a of document.querySelectorAll('nav a[href^="/c/"]')) {
      const href = a.getAttribute("href") || "";
      // href shape: /c/<uuid>[?query]; named group `id` is the bare conversation id.
      const idMatch = href.match(/\/c\/(?<id>[0-9a-f-]+)/i);
      const label = norm(a.getAttribute("aria-label") || a.textContent);
      // aria-label shape: "<title>" or "<title>, chat in project <Project>".
      const projMatch = label.match(/^(?<title>.*?),?\s*chat in project\s+(?<project>.+)$/i);
      out.push({
        id: idMatch?.groups?.id ?? href,
        title: projMatch?.groups?.title ?? label,
        project: projMatch?.groups?.project ?? null,
      });
    }
    return out;
  });

const main = async () => {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  let page = context.pages().find((p) => p.url().includes("chatgpt.com"));
  if (!page) {
    page = await context.newPage();
    await page.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded" });
  }
  await page.bringToFront();
  await page.waitForSelector('nav a[href^="/c/"]', { timeout: 15_000 });

  let prev = 0;
  let stable = 0;
  for (let i = 0; i < 80 && stable < 4; i += 1) {
    await page.evaluate(() => {
      const a = document.querySelector('nav a[href^="/c/"]');
      let el = a ? a.closest("nav") : document.querySelector("nav");
      while (el && el.scrollHeight <= el.clientHeight + 20) el = el.parentElement;
      (el || document.scrollingElement).scrollBy(0, 100_000);
    });
    await page.waitForTimeout(450);
    const count = await page.locator('nav a[href^="/c/"]').count();
    stable = count === prev ? stable + 1 : 0;
    prev = count;
  }

  const all = await scrape(page);
  const byId = new Map();
  for (const chat of all) if (!byId.has(chat.id)) byId.set(chat.id, chat);
  const list = [...byId.values()];

  const tally = {};
  for (const chat of list) {
    const key = chat.project ?? "(loose)";
    tally[key] = (tally[key] || 0) + 1;
  }
  console.log(JSON.stringify(list, null, 2));
  console.error(`\ntotal unique conversations: ${list.length}`);
  console.error(`by project: ${JSON.stringify(tally, null, 2)}`);
  await browser.close();
};

await main();
