#!/usr/bin/env node
// Dev-only recon: on a chat's sidebar-row ⋯ menu, open "Move to project" and dump the destination
// picker (any search input + the project menuitems + whether it scrolls) so the move can select a
// project reliably. Read-only: Escapes out without moving.
//
//   node src/scripts/dev/probeMoveSubmenu.mjs <conversationId>
//
import { chromium } from "playwright";

const CDP_URL = "http://127.0.0.1:9222";
const ID = process.argv[2] || "6a533a0a-a9bc-83eb-8818-0904574c438b";

const scrollHunt = async (page, id) => {
  for (let i = 0; i < 80; i += 1) {
    const hit = await page.evaluate(
      (cid) =>
        Array.from(document.querySelectorAll('nav a[href^="/c/"]')).some((a) =>
          (a.getAttribute("href") || "").startsWith(`/c/${cid}`),
        ),
      id,
    );
    if (hit) return true;
    await page.evaluate(() => {
      const a = document.querySelector('nav a[href^="/c/"]');
      let el = a ? a.closest("nav") : document.querySelector("nav");
      while (el && el.scrollHeight <= el.clientHeight + 20) el = el.parentElement;
      (el || document.scrollingElement).scrollBy(0, 800);
    });
    await page.waitForTimeout(200);
  }
  return false;
};

const dumpMenu = (page) =>
  page.evaluate(() => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const items = Array.from(document.querySelectorAll('[role="menuitem"], [role="option"]')).map(
      (i) => norm(i.textContent),
    );
    const inputs = Array.from(document.querySelectorAll("input")).map((i) => ({
      placeholder: i.getAttribute("placeholder"),
      ariaLabel: i.getAttribute("aria-label"),
    }));
    return { items, inputs };
  });

const main = async () => {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  let page = context.pages().find((p) => p.url().includes("chatgpt.com"));
  if (!page) page = await context.newPage();
  await page.goto(`https://chatgpt.com/c/${ID}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await page.bringToFront();

  const found = await scrollHunt(page, ID);
  console.log("row found via scroll:", found);
  if (!found) return void (await browser.close());

  const row = page.locator(`nav a[href^="/c/${ID}"]`).first();
  const li = row.locator("xpath=ancestor-or-self::li[1]");
  const scope = (await li.count()) > 0 ? li : row;
  await scope.hover().catch(() => {});
  await page.waitForTimeout(200);
  const optBtn = scope.locator('button[aria-label^="Open conversation options"]').first();
  await optBtn.dispatchEvent("pointerdown", { button: 0, isPrimary: true, pointerType: "mouse" });
  await page.waitForTimeout(500);
  console.log("row menu:", JSON.stringify(await dumpMenu(page)));

  const moveItem = page
    .getByRole("menuitem")
    .filter({ hasText: /^Move to project$/i })
    .first();
  await moveItem.hover().catch(() => {});
  await page.waitForTimeout(500);
  let after = await dumpMenu(page);
  if (after.items.length <= 8) {
    await moveItem.click().catch(() => {});
    await page.waitForTimeout(600);
    after = await dumpMenu(page);
  }
  console.log("after Move-to-project:", JSON.stringify(after, null, 2));

  await page.keyboard.press("Escape").catch(() => {});
  await page.keyboard.press("Escape").catch(() => {});
  await browser.close();
};

await main();
