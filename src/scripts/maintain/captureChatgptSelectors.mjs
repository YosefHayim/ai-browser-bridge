#!/usr/bin/env node
// Dev-only recon for building the ChatGPT workspace-ops adapters (project / chat / task).
// Attaches to the warm bridge Chrome over CDP (port 9222) and dumps the real selectors for:
//   • the sidebar nav (Projects / Scheduled / New chat / profile),
//   • chat rows (title + /c/<id> href + the ⋯ "options" button),
//   • the chat ⋯ menu items (incl. "Move to project"),
//   • the Projects page + the "New project" dialog fields,
//   • the /scheduled (Tasks) page.
//
// To reveal the menu/dialog selectors it OPENS the chat ⋯ menu and the New Project dialog,
// then immediately presses Escape. It NEVER clicks a mutating control (a move target,
// Rename / Archive / Delete, or Create / Save) and never confirms anything; page
// navigation is GET-only and Projects/Scheduled are probed in a throwaway tab so the
// main window stays put. Run AFTER `bridge chrome start` (sign into ChatGPT if needed, leave Chrome open):
//
//   node src/scripts/maintain/captureChatgptSelectors.mjs
//
import { chromium } from "playwright";

const CDP_URL = "http://127.0.0.1:9222";

// --- probes (serialized into the page; each redefines its own `clip`) ---

/** Sidebar nav, the New Project button, and chat rows with href + options-button testid. */
const sidebarProbe = () => {
  const clip = (s, n = 80) => (s || "").replace(/\s+/g, " ").trim().slice(0, n);
  const optByTitle = new Map();
  for (const b of document.querySelectorAll(
    'button[aria-label^="Open conversation options for"]',
  )) {
    const title = (b.getAttribute("aria-label") || "").replace(
      /^Open conversation options for /,
      "",
    );
    optByTitle.set(title, b.getAttribute("data-testid") || "");
  }
  const chats = [...document.querySelectorAll('a[href^="/c/"]')].map((a) => {
    const title = clip(a.getAttribute("aria-label") || a.textContent);
    return { title, href: a.getAttribute("href"), optionsTestid: optByTitle.get(title) ?? "" };
  });
  const nav = [
    ...document.querySelectorAll(
      'a[data-testid^="sidebar-item"], a[data-testid="create-new-chat-button"]',
    ),
  ].map((a) => ({
    testid: a.getAttribute("data-testid"),
    text: clip(a.textContent),
    href: a.getAttribute("href"),
  }));
  const newProject = document.querySelector('button[aria-label="New project"]');
  return {
    url: location.href,
    signedIn: Boolean(document.querySelector('#prompt-textarea, [contenteditable="true"]')),
    nav,
    newProjectButton: newProject
      ? { aria: "New project", testid: newProject.getAttribute("data-testid") || "" }
      : null,
    chatCount: chats.length,
    chats: chats.slice(0, 15),
  };
};

/** Items in whatever popover menu is currently open. */
const menuProbe = () => {
  const clip = (s, n = 60) => (s || "").replace(/\s+/g, " ").trim().slice(0, n);
  const items = [
    ...document.querySelectorAll(
      '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]',
    ),
  ].map((m) => ({
    text: clip(m.textContent),
    testid: m.getAttribute("data-testid") || "",
    role: m.getAttribute("role"),
  }));
  return { count: items.length, items };
};

/** Projects page: enumerate project cards. Scans the main content (outside the sidebar) so
 *  project entries aren't confused with sidebar nav; records href + testid patterns. */
const projectsProbe = () => {
  const clip = (s, n = 60) => (s || "").replace(/\s+/g, " ").trim().slice(0, n);
  const sidebar = document.querySelector("nav, aside");
  const inSidebar = (el) => Boolean(sidebar?.contains(el));
  const seen = new Set();
  const anchors = [];
  for (const a of document.querySelectorAll("main a[href], [role='main'] a[href], a[href]")) {
    if (inSidebar(a)) continue;
    const href = a.getAttribute("href") || "";
    const key = `${href}|${clip(a.textContent)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    anchors.push({ href, text: clip(a.textContent), testid: a.getAttribute("data-testid") || "" });
  }
  const testids = [
    ...new Set(
      [...document.querySelectorAll("main [data-testid], [role='main'] [data-testid]")].map((e) =>
        e.getAttribute("data-testid"),
      ),
    ),
  ];
  // Project rows: walk up from each folder icon to its clickable row and record shape.
  const projectRows = [...document.querySelectorAll('[data-testid="project-folder-icon"]')].map(
    (icon) => {
      const row =
        icon.closest('a[href], [role="row"], [role="button"], button, li, tr') ||
        icon.parentElement;
      return {
        rowTag: row?.tagName.toLowerCase() || "",
        rowRole: row?.getAttribute("role") || "",
        href: row?.getAttribute("href") || "",
        testid: row?.getAttribute("data-testid") || "",
        name: clip(row?.textContent),
      };
    },
  );
  const newProject = document.querySelector('button[aria-label="New project"]');
  return {
    url: location.href,
    projectRowCount: projectRows.length,
    projectRows: projectRows.slice(0, 30),
    mainTestids: testids.slice(0, 30),
    newProjectButton: newProject
      ? { testid: newProject.getAttribute("data-testid") || "", text: clip(newProject.textContent) }
      : null,
  };
};

/** Inputs/buttons inside the currently-open dialog (New Project). */
const dialogProbe = () => {
  const clip = (s, n = 60) => (s || "").replace(/\s+/g, " ").trim().slice(0, n);
  const dlg = document.querySelector('[role="dialog"]') || document.body;
  return {
    isDialog: Boolean(document.querySelector('[role="dialog"]')),
    url: location.href,
    headings: [...dlg.querySelectorAll('h1,h2,h3,[role="heading"]')]
      .map((h) => clip(h.textContent))
      .filter(Boolean),
    inputs: [...dlg.querySelectorAll('input, textarea, [contenteditable="true"]')].map((i) => ({
      tag: i.tagName.toLowerCase(),
      type: i.getAttribute("type") || "",
      name: i.getAttribute("name") || "",
      placeholder: i.getAttribute("placeholder") || "",
      testid: i.getAttribute("data-testid") || "",
      aria: i.getAttribute("aria-label") || "",
    })),
    buttons: [...dlg.querySelectorAll('button, [role="button"]')]
      .map((b) => ({
        text: clip(b.textContent),
        testid: b.getAttribute("data-testid") || "",
        type: b.getAttribute("type") || "",
      }))
      .filter((b) => b.text),
  };
};

/** Generic page probe (headings + testids + labelled controls) for /scheduled. */
const genericProbe = () => {
  const clip = (s, n = 60) => (s || "").replace(/\s+/g, " ").trim().slice(0, n);
  const seen = new Set();
  const controls = [];
  for (const b of document.querySelectorAll('button, [role="button"], a[href]')) {
    const entry = {
      tag: b.tagName.toLowerCase(),
      text: clip(b.textContent),
      aria: clip(b.getAttribute("aria-label") || ""),
      testid: b.getAttribute("data-testid") || "",
    };
    if (!entry.text && !entry.aria && !entry.testid) continue;
    const k = JSON.stringify(entry);
    if (seen.has(k)) continue;
    seen.add(k);
    controls.push(entry);
  }
  return {
    url: location.href,
    headings: [
      ...new Set(
        [...document.querySelectorAll('h1,h2,h3,[role="heading"]')]
          .map((h) => clip(h.textContent))
          .filter(Boolean),
      ),
    ].slice(0, 15),
    testids: [
      ...new Set(
        [...document.querySelectorAll("[data-testid]")].map((e) => e.getAttribute("data-testid")),
      ),
    ].slice(0, 45),
    controls: controls.slice(0, 45),
  };
};

/** Find an already-open chatgpt.com page, or open one in the first context. */
const findChatgptPage = async (browser) => {
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      if (page.url().includes("chatgpt.com")) return { context, page };
    }
  }
  const [context] = browser.contexts();
  if (!context) return null;
  const page = await context.newPage();
  await page.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded" });
  return { context, page };
};

/** Open the first chat's ⋯ menu (and the "Move to project" submenu) read-only, then Escape. */
const probeChatMenu = async (page, sidebar) => {
  const target = sidebar.chats.find((c) => c.optionsTestid && c.href);
  if (!target) return { note: "no chat options button found" };
  try {
    await page.hover(`a[href="${target.href}"]`).catch(() => {});
    await page.waitForTimeout(250);
    await page.click(`[data-testid="${target.optionsTestid}"]`, { force: true, timeout: 8000 });
    await page.waitForSelector('[role="menuitem"]', { timeout: 5000 });
    const menu = await page.evaluate(menuProbe);
    let moveSubmenu = null;
    const moveLoc = page.getByRole("menuitem", { name: /move to/i });
    if (await moveLoc.count()) {
      try {
        await moveLoc.first().hover();
        await page.waitForTimeout(700);
        moveSubmenu = await page.evaluate(menuProbe);
      } catch {
        moveSubmenu = { error: "could not open move submenu" };
      }
    }
    await page.keyboard.press("Escape").catch(() => {});
    await page.keyboard.press("Escape").catch(() => {});
    return { forChat: target.title, menu, moveSubmenu };
  } catch (err) {
    await page.keyboard.press("Escape").catch(() => {});
    return { error: String(err).split("\n")[0] };
  }
};

/** Open the sidebar "New project" control on the main (expanded) window, read it, then Escape. */
const probeNewProject = async (page) => {
  const before = page.url();
  try {
    await page.hover('[data-testid="sidebar-item-projects"]').catch(() => {});
    await page.waitForTimeout(250);
    await page
      .locator('button[aria-label="New project"]')
      .first()
      .click({ force: true, timeout: 6000 });
    await page.waitForTimeout(1200);
    const dlg = await page.evaluate(dialogProbe);
    await page.keyboard.press("Escape").catch(() => {});
    if (page.url() !== before) {
      await page.goto(before, { waitUntil: "domcontentloaded" }).catch(() => {});
    }
    return dlg;
  } catch (err) {
    await page.keyboard.press("Escape").catch(() => {});
    return { error: String(err).split("\n")[0] };
  }
};

/** In a throwaway tab: enumerate Projects, then read the /scheduled (Tasks) page. */
const probeProjectsAndSchedule = async (context, projectsHref) => {
  const tab = await context.newPage();
  const out = {};
  try {
    const path = projectsHref?.startsWith("/") ? projectsHref : `/${projectsHref || "projects"}`;
    await tab.goto(`https://chatgpt.com${path}`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });
    await tab.waitForTimeout(1500);
    out.projects = await tab.evaluate(projectsProbe);
    await tab.goto("https://chatgpt.com/scheduled", {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });
    await tab.waitForTimeout(1800);
    out.scheduled = await tab.evaluate(genericProbe);
  } catch (err) {
    out.error = String(err).split("\n")[0];
  } finally {
    await tab.close().catch(() => {});
  }
  return out;
};

let browser;
try {
  browser = await chromium.connectOverCDP(CDP_URL);
} catch {
  console.error(
    `Could not attach to Chrome on ${CDP_URL}.\nRun \`node dist/bridge.js chrome start\` (or \`bridge chrome start\`), sign into ChatGPT if needed, leave Chrome open, then re-run: node src/scripts/maintain/captureChatgptSelectors.mjs`,
  );
  process.exit(1);
}

const found = await findChatgptPage(browser);
if (!found) {
  console.error("Attached, but no browser context to inspect.");
  process.exit(1);
}
const { context, page } = found;

if (!/chatgpt\.com\/?($|\?)/.test(page.url())) {
  await page.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded" });
}
await page.waitForSelector('a[href^="/c/"]', { timeout: 15_000 }).catch(() => {});
await page.waitForTimeout(800);

const sidebar = await page.evaluate(sidebarProbe);
console.log("=== SIDEBAR / NAV / CHATS ===");
console.log(JSON.stringify(sidebar, null, 2));

console.log("\n=== CHAT ⋯ MENU + MOVE-TO-PROJECT SUBMENU (opened read-only, then Escaped) ===");
console.log(JSON.stringify(await probeChatMenu(page, sidebar), null, 2));

console.log("\n=== NEW PROJECT DIALOG (opened read-only, then Escaped) ===");
console.log(JSON.stringify(await probeNewProject(page), null, 2));

const projectsHref = sidebar.nav.find((n) => n.testid === "sidebar-item-projects")?.href;
const rest = await probeProjectsAndSchedule(context, projectsHref);
console.log("\n=== PROJECTS PAGE (enumeration) ===");
console.log(JSON.stringify(rest.projects ?? { error: rest.error }, null, 2));
console.log("\n=== /scheduled (TASKS) PAGE ===");
console.log(JSON.stringify(rest.scheduled ?? { error: rest.error }, null, 2));

console.log("\n(recon done — Chrome left running)");
process.exit(0);
