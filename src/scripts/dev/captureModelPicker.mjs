#!/usr/bin/env node
// Dev-only model-picker recon: capture the option selectors each provider's model
// menu exposes, so the generic adapter can implement listAvailableModels / selectModel.
//
// It attaches to the warm bridge Chrome over CDP (:9222), and for each provider it
// clicks the configured model-picker TRIGGER, reads the option items that appear
// (selector / role / label / selected-state), then presses Escape to close the menu.
// It NEVER clicks an option, so it does not change the selected model — the only
// interaction is opening and closing the picker. Structure only, no chat text.
//
//   node src/scripts/dev/captureModelPicker.mjs            # claude, grok, perplexity
//   node src/scripts/dev/captureModelPicker.mjs claude
//
// Output is written under downloads/ (gitignored) — nothing enters git.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REPORT_DIR = join(REPO_ROOT, "downloads", "verify-providers");
const CDP_URL = "http://127.0.0.1:9222";

// Model-picker trigger per provider — mirrors modelTrigger in providersConfig.ts.
const PICKERS = {
  claude: { origin: "claude.ai", trigger: '[data-testid="model-selector-dropdown"]' },
  grok: { origin: "grok.com", trigger: 'button[aria-label="Model select"]' },
  perplexity: { origin: "perplexity.ai", trigger: 'button[aria-label="Model"]' },
};

const DEFAULT_PROVIDERS = ["claude", "grok", "perplexity"];

/** Serialized into the page after the picker opens: enumerate the option items. */
function pickerProbe() {
  const clip = (s, n = 60) => (s || "").replace(/\s+/g, " ").trim().slice(0, n);
  const best = (el) => {
    const tid = el.getAttribute("data-testid");
    if (tid) return `[data-testid="${tid}"]`;
    const aria = el.getAttribute("aria-label");
    if (aria)
      return `${el.tagName.toLowerCase()}[aria-label="${aria.replace(/"/g, "'").slice(0, 40)}"]`;
    const role = el.getAttribute("role");
    if (role) return `[role="${role}"]`;
    const cls = (typeof el.className === "string" ? el.className : "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2);
    return cls.length ? `${el.tagName.toLowerCase()}.${cls.join(".")}` : el.tagName.toLowerCase();
  };
  const selectors = [
    '[role="menuitem"]',
    '[role="menuitemradio"]',
    '[role="option"]',
    "[cmdk-item]",
    "li[data-value]",
  ];
  const seen = new Set();
  const items = [];
  for (const sel of selectors) {
    for (const el of document.querySelectorAll(sel)) {
      const text = clip(el.textContent, 50);
      if (!text) continue;
      const key = `${sel}|${text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        matchedBy: sel,
        selector: best(el),
        role: el.getAttribute("role") || "",
        testid: el.getAttribute("data-testid") || "",
        text,
        selected:
          el.getAttribute("aria-checked") === "true" ||
          el.getAttribute("aria-selected") === "true" ||
          el.getAttribute("data-state") === "checked",
      });
      if (items.length >= 30) break;
    }
  }
  return { count: items.length, items };
}

async function findPage(browser, origin) {
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      if (page.url().includes(origin)) return page;
    }
  }
  return null;
}

async function captureOne(browser, id) {
  const picker = PICKERS[id];
  if (!picker) return { provider: id, error: "unknown provider" };
  const page = await findPage(browser, picker.origin);
  if (!page) return { provider: id, error: `no ${picker.origin} tab open` };
  const opened = await page
    .locator(picker.trigger)
    .first()
    .click({ timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (!opened) return { provider: id, error: `could not open picker via ${picker.trigger}` };
  await page.waitForTimeout(900);
  const result = await page
    .evaluate(pickerProbe)
    .catch((err) => ({ count: 0, items: [], error: String(err).split("\n")[0] }));
  await page.keyboard.press("Escape").catch(() => {});
  return { provider: id, trigger: picker.trigger, ...result };
}

async function main() {
  const requested = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const providers = requested.length > 0 ? requested : DEFAULT_PROVIDERS;

  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
  } catch {
    console.error(`Could not attach to Chrome on ${CDP_URL}. Sign in and leave Chrome open.`);
    process.exit(1);
  }

  const reports = [];
  for (const id of providers) {
    const report = await captureOne(browser, id);
    if (report.error) {
      console.log(`\n### ${id} — ${report.error}`);
    } else {
      console.log(`\n### ${id}  (${report.count} options via ${report.trigger})`);
      for (const item of report.items)
        console.log(`    ${item.selected ? "●" : "○"} ${item.selector.padEnd(28)} "${item.text}"`);
    }
    reports.push(report);
  }

  await mkdir(REPORT_DIR, { recursive: true });
  const reportPath = join(REPORT_DIR, "modelPicker.json");
  await writeFile(reportPath, `${JSON.stringify(reports, null, 2)}\n`, "utf-8");
  console.log(`\nFull report: ${reportPath}`);
  process.exit(0);
}

await main();
