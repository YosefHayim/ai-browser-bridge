#!/usr/bin/env node
// Dev-only recon of Claude's custom MCP connector setup UI.
//
// Claude's settings are a hash-modal opened from the user menu (direct navigation to
// /settings/connectors does NOT open it), so this drives the click-path step by step:
//   user menu → Settings → Connectors tab → (--open-dialog) Add custom connector
// After each click it snapshots the visible controls in the topmost dialog so we can
// read off the next selector. It presses Escape at the end and NEVER clicks a submit /
// Add / Create / Save button, so it cannot create a connector or mutate the account.
// Structure only (tags / roles / aria / testids) — no chat text, ids redacted.
//
//   node src/scripts/dev/captureClaudeConnector.mjs               # walk to the Connectors panel
//   node src/scripts/dev/captureClaudeConnector.mjs --open-dialog # + open the UNSUBMITTED Add form
//
// Output under downloads/ (gitignored).
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
const CDP_URL = "http://127.0.0.1:9222";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REPORT_DIR = join(REPO_ROOT, "downloads", "verify-providers");

/** Snapshot the visible interactive controls in the topmost dialog (or main content). */
const snapshot = () => {
  const clip = (s, n = 44) => (s || "").replace(/\s+/g, " ").trim().slice(0, n);
  const best = (el) => {
    const tid = el.getAttribute("data-testid");
    if (tid) return `[data-testid="${tid}"]`;
    const name = el.getAttribute("name");
    if (name) return `${el.tagName.toLowerCase()}[name="${name}"]`;
    const aria = el.getAttribute("aria-label");
    if (aria)
      return `${el.tagName.toLowerCase()}[aria-label="${aria.replace(/"/g, "'").slice(0, 40)}"]`;
    if (el.id) return `#${el.id}`;
    const cls = (typeof el.className === "string" ? el.className : "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2);
    return cls.length ? `${el.tagName.toLowerCase()}.${cls.join(".")}` : el.tagName.toLowerCase();
  };
  // Prefer the topmost overlay (last in DOM) — a popover menu opened on top of the
  // settings dialog comes after it, so the last match is the currently-active surface.
  const overlays = [...document.querySelectorAll('[role="menu"], [role="dialog"], dialog')];
  const scope = overlays.length
    ? overlays[overlays.length - 1]
    : document.querySelector("main") || document.body;
  const controls = [];
  const seen = new Set();
  for (const el of scope.querySelectorAll(
    'button, [role="button"], [role="menuitem"], [role="tab"], a[href], input, textarea',
  )) {
    if (el.closest("nav, aside")) continue;
    if ((el.getAttribute("href") || "").includes("/chat/")) continue;
    const text = clip(el.textContent, 40);
    const aria = clip(el.getAttribute("aria-label") || "");
    const placeholder = clip(el.getAttribute("placeholder") || "");
    const label = text || aria || placeholder;
    if (!label) continue;
    const key = `${el.tagName}|${label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    controls.push({
      selector: best(el),
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role") || "",
      type: el.getAttribute("type") || "",
      text,
      aria,
      placeholder,
    });
    if (controls.length >= 40) break;
  }
  return { dialog: Boolean(document.querySelector('[role="dialog"], dialog')), controls };
};

const main = async () => {
  const fillCancel = process.argv.includes("--fill-cancel");
  const openDialog = process.argv.includes("--open-dialog") || fillCancel;
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
  } catch {
    console.error(`Could not attach to Chrome on ${CDP_URL}. Sign into Claude and leave it open.`);
    process.exit(1);
  }
  const [context] = browser.contexts();
  if (!context) {
    console.error("No browser context to inspect.");
    process.exit(1);
  }
  const page = await context.newPage();
  const steps = [];

  const step = async (label, action) => {
    if (page.isClosed()) {
      console.log(`\n## ${label} — page already closed, skipping`);
      return;
    }
    const ok = await action()
      .then(() => true)
      .catch(() => false);
    await page.waitForTimeout(1_000).catch(() => {});
    if (page.isClosed()) {
      console.log(`\n## ${label} (clicked=${ok}) — page closed after action`);
      return;
    }
    const snap = await page.evaluate(snapshot).catch(() => ({ dialog: false, controls: [] }));
    steps.push({ label, clicked: ok, dialog: snap.dialog, controls: snap.controls });
    console.log(`\n## ${label}  (clicked=${ok}, dialog=${snap.dialog})`);
    for (const c of snap.controls) {
      const kind = c.type ? `${c.tag}:${c.type}` : c.role || c.tag;
      console.log(`   [${kind}] ${c.selector.padEnd(34)} "${c.text || c.aria || c.placeholder}"`);
    }
  };

  try {
    await page
      .goto("https://claude.ai/new", { waitUntil: "domcontentloaded", timeout: 25_000 })
      .catch(() => {});
    await page.waitForTimeout(2_500);
    await step("open account menu", () =>
      page.locator('[data-testid="user-menu-button"]').first().click({ timeout: 5_000 }),
    );
    await step("click Settings", () =>
      page
        .locator('[role="menuitem"], [role="menu"] a, [role="menu"] button, a[href*="settings"]')
        .filter({ hasText: /settings/i })
        .first()
        .click({ timeout: 5_000 }),
    );
    await step("open Connectors", () =>
      page
        .locator('[role="tab"], [role="menuitem"], a[href], button')
        .filter({ hasText: /connectors/i })
        .first()
        .click({ timeout: 5_000 }),
    );
    if (openDialog) {
      await step("click Add connector", () =>
        page.locator('button[aria-label="Add connector"]').first().click({ timeout: 5_000 }),
      );
      await step("open custom connector form", () =>
        page
          .locator('[role="menuitem"], button, [role="button"]')
          .filter({ hasText: /custom|advanced|url|mcp/i })
          .first()
          .click({ timeout: 5_000 }),
      );
      if (fillCancel && !page.isClosed()) {
        const name = page.locator('input[placeholder="Name"]').first();
        const url = page.locator('input[placeholder="Remote MCP server URL"]').first();
        await name.fill("ai-browser-bridge (dry-run)").catch(() => {});
        await url.fill("https://dry-run.invalid/mcp").catch(() => {});
        const nameVal = await name.inputValue().catch(() => "");
        const urlVal = await url.inputValue().catch(() => "");
        console.log(`\n## fill dry-run (will Cancel): name="${nameVal}" url="${urlVal}"`);
        await page
          .getByRole("button", { name: /^cancel$/i })
          .first()
          .click({ timeout: 5_000 })
          .catch(() => {});
        console.log("   clicked Cancel — nothing was submitted");
      }
    }
  } finally {
    await page.keyboard.press("Escape").catch(() => {});
    await page.keyboard.press("Escape").catch(() => {});
    await page.close().catch(() => {});
  }

  await mkdir(REPORT_DIR, { recursive: true });
  const reportPath = join(REPORT_DIR, "claudeConnector.json");
  await writeFile(reportPath, `${JSON.stringify(steps, null, 2)}\n`, "utf-8");
  console.log(`\nReport: ${reportPath}`);
  process.exit(0);
};

await main();
