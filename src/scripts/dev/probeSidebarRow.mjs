#!/usr/bin/env node
// Dev-only recon: after opening a conversation by id, inspect the sidebar to learn why its row is
// not found — how many chat links are mounted, whether the target href/active row is present, and
// whether the conversation header exposes a "Move to project" action we could use instead.
//
//   node src/scripts/dev/probeSidebarRow.mjs <conversationId>
//
import { chromium } from "playwright";

const CDP_URL = "http://127.0.0.1:9222";
const ID = process.argv[2] || "6a534b69-f618-83ed-812d-281c3b4d049c";

const main = async () => {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  let page = context.pages().find((p) => p.url().includes("chatgpt.com"));
  if (!page) page = await context.newPage();
  await page.goto(`https://chatgpt.com/c/${ID}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.bringToFront();

  const info = await page.evaluate((id) => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const links = Array.from(document.querySelectorAll('nav a[href^="/c/"]'));
    const hrefs = links.map((a) => a.getAttribute("href"));
    const target = links.find((a) => (a.getAttribute("href") || "").startsWith(`/c/${id}`));
    const active = document.querySelector('nav a[aria-current], nav a[data-active="true"]');
    // The conversation header actions (kebab / share row) at the top of the thread.
    const header =
      document.querySelector('main header, [class*="sticky"] , header') || document.body;
    const headerButtons = Array.from(header.querySelectorAll("button"))
      .map((b) => norm(b.getAttribute("aria-label") || b.textContent))
      .filter(Boolean)
      .slice(0, 15);
    return {
      totalSidebarLinks: links.length,
      targetInSidebar: Boolean(target),
      targetAriaLabel: target ? target.getAttribute("aria-label") : null,
      activeRowHref: active ? active.getAttribute("href") : null,
      firstFiveHrefs: hrefs.slice(0, 5),
      headerButtons,
      url: location.href,
    };
  }, ID);
  console.log(JSON.stringify(info, null, 2));

  // Scroll-hunt the sidebar for the target href, mimicking findChatRow's fallback.
  let found = false;
  let maxLinks = info.totalSidebarLinks;
  for (let i = 0; i < 80 && !found; i += 1) {
    await page.evaluate(() => {
      const anchor = document.querySelector('nav a[href^="/c/"]');
      let el = anchor ? anchor.closest("nav") : document.querySelector("nav");
      while (el && el.scrollHeight <= el.clientHeight + 20) el = el.parentElement;
      (el || document.scrollingElement).scrollBy(0, 600);
    });
    await page.waitForTimeout(200);
    const state = await page.evaluate((id) => {
      const links = Array.from(document.querySelectorAll('nav a[href^="/c/"]'));
      return {
        count: links.length,
        hit: links.some((a) => (a.getAttribute("href") || "").startsWith(`/c/${id}`)),
      };
    }, ID);
    maxLinks = Math.max(maxLinks, state.count);
    if (state.hit) found = true;
  }
  console.log(`scroll-hunt: found=${found}  maxSidebarLinksSeen=${maxLinks}`);

  // Identify the conversation-level kebab button, open it, then open "Move to project" and dump the
  // project submenu so we can build a virtualization-proof move from inside the open conversation.
  const kebabInfo = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const k = btns.find((b) => /options|more/i.test(b.getAttribute("aria-label") || ""));
    return k
      ? { ariaLabel: k.getAttribute("aria-label"), testid: k.getAttribute("data-testid") }
      : null;
  });
  console.log("kebab button:", JSON.stringify(kebabInfo));
  const kebab = page
    .getByRole("button", { name: /open conversation options|more|options/i })
    .first();
  if (await kebab.isVisible({ timeout: 1500 }).catch(() => false)) {
    await kebab.dispatchEvent("pointerdown", { button: 0, isPrimary: true, pointerType: "mouse" });
    await page.waitForTimeout(600);
    const items = await page
      .locator('[role="menuitem"]')
      .allTextContents()
      .catch(() => []);
    console.log("conversation menu items:", JSON.stringify(items));
    const moveItem = page
      .getByRole("menuitem")
      .filter({ hasText: /^Move to project$/i })
      .first();
    if (await moveItem.isVisible({ timeout: 1000 }).catch(() => false)) {
      await moveItem.hover();
      await page.waitForTimeout(500);
      let subItems = await page
        .locator('[role="menuitem"]')
        .allTextContents()
        .catch(() => []);
      if (subItems.length <= items.length) {
        await moveItem.click().catch(() => {});
        await page.waitForTimeout(500);
        subItems = await page
          .locator('[role="menuitem"]')
          .allTextContents()
          .catch(() => []);
      }
      console.log("move-to-project submenu:", JSON.stringify(subItems));
    }
    await page.keyboard.press("Escape").catch(() => {});
    await page.keyboard.press("Escape").catch(() => {});
  } else {
    console.log("no conversation-level kebab found by that name");
  }

  await browser.close();
};

await main();
