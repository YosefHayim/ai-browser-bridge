#!/usr/bin/env node
// Dev-only selector recon for the web-chat providers.
//
// Attaches to the warm bridge Chrome over CDP (:9222) and, for each provider,
// validates the selectors declared in src/config/providersConfig.ts against the
// REAL signed-in DOM, then discovers the actual composer / assistant / control /
// sidebar / model affordances each platform exposes. The configured selectors are
// flagged LIVE-VERIFY in the source — this is that verification.
//
// It is strictly READ-ONLY: it queries the DOM (querySelectorAll / attributes) and
// never clicks, types, submits, or opens a menu, so it cannot mutate any account.
// It records STRUCTURE only — tag names, classes, data-testids, aria-labels, and
// counts — never message text or conversation titles, and it redacts ids out of
// URLs. Run AFTER signing into each provider (and ideally after a prompt has been
// sent, so an assistant message exists to match):
//
//   node dist/bridge.js login --provider claude     # sign in once, per provider
//   node scripts/dev/verifyProviders.mjs            # leaves a reply on each tab
//   node scripts/dev/captureProviderSelectors.mjs   # then capture selectors
//
// Output is written under downloads/ (gitignored) — nothing enters git.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REPORT_DIR = join(REPO_ROOT, "downloads", "verify-providers");
const CDP_URL = "http://127.0.0.1:9222";

// Mirrors src/config/providersConfig.ts — the exact selector strings under test.
// Kept local because the whole job is to check THESE strings against reality.
const PROVIDERS = {
  chatgpt: {
    origin: "chatgpt.com",
    defaultUrl: "https://chatgpt.com",
    selectors: {
      composer: '#prompt-textarea, [contenteditable="true"]',
      assistant: '[data-message-author-role="assistant"]',
    },
  },
  gemini: {
    origin: "gemini.google.com",
    defaultUrl: "https://gemini.google.com/app",
    selectors: {
      composer: 'div.ql-editor, [contenteditable="true"]',
      assistant: "model-response, message-content, .model-response-text, .response-content",
    },
  },
  claude: {
    origin: "claude.ai",
    defaultUrl: "https://claude.ai/new",
    selectors: {
      composer: 'div[contenteditable="true"]',
      assistant: "div.font-claude-message",
      user: '[data-testid="user-message"]',
      stop: 'button[aria-label="Stop response"]',
      signedOut: 'a[href*="/login"]',
    },
  },
  deepseek: {
    origin: "chat.deepseek.com",
    defaultUrl: "https://chat.deepseek.com/",
    selectors: {
      composer: "textarea#chat-input, textarea",
      assistant: ".ds-markdown",
      stop: 'div[role="button"][aria-label*="Stop"]',
      signedOut: 'button:has-text("Log in")',
    },
  },
  grok: {
    origin: "grok.com",
    defaultUrl: "https://grok.com/",
    selectors: {
      composer: "textarea",
      assistant: '[class*="message-bubble"]',
      stop: 'button[aria-label*="Stop"]',
      signedOut: 'button:has-text("Sign in")',
    },
  },
  perplexity: {
    origin: "perplexity.ai",
    defaultUrl: "https://www.perplexity.ai/",
    selectors: {
      composer: 'textarea, div[contenteditable="true"]',
      assistant: ".prose",
      stop: 'button[aria-label*="Stop"]',
      signedOut: 'button:has-text("Sign Up")',
    },
  },
};

const DEFAULT_PROVIDERS = ["claude", "deepseek", "grok", "perplexity", "gemini"];

/**
 * DOM probe serialized into the page. Given the configured selector set, it reports
 * whether each resolves and enumerates the real candidates. Pure structure — no text.
 */
function selectorProbe(configured) {
  const clip = (s, n = 60) => (s || "").replace(/\s+/g, " ").trim().slice(0, n);
  const clsOf = (el) => clip(typeof el.className === "string" ? el.className : "", 80);
  const redact = (s) => (s || "").replace(/[0-9a-f]{8,}|[0-9a-f-]{16,}/gi, "<id>");

  // Playwright-only pseudo-selectors (:has-text) can't run in the DOM — skip them here.
  const domSafe = (sel) => sel && !sel.includes(":has-text");
  const countOf = (sel) => {
    if (!domSafe(sel))
      return { count: -1, note: "playwright :has-text (checked by bridge, not DOM)" };
    try {
      return { count: document.querySelectorAll(sel).length };
    } catch {
      return { count: -1, note: "invalid in DOM" };
    }
  };

  const configuredResults = {};
  for (const [role, sel] of Object.entries(configured)) {
    configuredResults[role] = { selector: sel, ...countOf(sel) };
  }

  const composers = [
    ...document.querySelectorAll('textarea, [contenteditable="true"], [contenteditable=""]'),
  ]
    .slice(0, 8)
    .map((el) => ({
      tag: el.tagName.toLowerCase(),
      id: el.id || "",
      cls: clsOf(el),
      placeholder: el.getAttribute("placeholder") || el.getAttribute("data-placeholder") || "",
      aria: clip(el.getAttribute("aria-label") || ""),
      testid: el.getAttribute("data-testid") || "",
    }));

  // Candidate assistant/user message containers, by the attribute patterns providers use.
  const messageSelectors = [
    "[data-message-author-role]",
    '[data-testid="user-message"]',
    '[data-testid*="message"]',
    "div.font-claude-message",
    ".ds-markdown",
    '[class*="message-bubble"]',
    ".prose",
    "model-response",
    "message-content",
    ".model-response-text",
    ".markdown",
    '[class*="markdown"]',
    '[class*="response"]',
  ];
  const messages = messageSelectors
    .map((sel) => ({ selector: sel, ...countOf(sel) }))
    .filter((m) => m.count > 0);

  const interesting =
    /send|stop|regenerate|new chat|new conversation|model|attach|voice|mic|search|research|submit/i;
  const controls = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('button, [role="button"]')) {
    const aria = clip(el.getAttribute("aria-label") || "");
    const testid = el.getAttribute("data-testid") || "";
    const text = clip(el.textContent, 40);
    const hay = `${aria} ${testid} ${text}`;
    if (!interesting.test(hay)) continue;
    const key = `${aria}|${testid}|${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    controls.push({
      tag: el.tagName.toLowerCase(),
      aria,
      testid,
      text,
      disabled: el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true",
    });
    if (controls.length >= 30) break;
  }

  const sidebarLinks = [
    ...document.querySelectorAll('a[href*="/c/"], a[href*="/chat/"], nav a[href], aside a[href]'),
  ];
  const sidebar = {
    convLinkCount: sidebarLinks.length,
    hrefSamples: [
      ...new Set(sidebarLinks.slice(0, 6).map((a) => redact(a.getAttribute("href") || ""))),
    ],
  };

  const modelKeyword =
    /\b(gpt|o1|o3|4o|claude|opus|sonnet|haiku|gemini|flash|pro|grok|deepseek|sonar|reasoner)\b/i;
  const modelHints = [];
  for (const el of document.querySelectorAll(
    'button, [role="button"], [role="combobox"], [aria-haspopup]',
  )) {
    const text = clip(el.textContent, 40);
    if (!text || text.length > 40 || !modelKeyword.test(text)) continue;
    modelHints.push({
      tag: el.tagName.toLowerCase(),
      text,
      testid: el.getAttribute("data-testid") || "",
      aria: clip(el.getAttribute("aria-label") || ""),
    });
    if (modelHints.length >= 8) break;
  }

  const composerPresent = countOf(configured.composer).count > 0;
  return {
    url: redact(location.origin + location.pathname),
    signedIn: composerPresent,
    configured: configuredResults,
    composers,
    messages,
    controls,
    sidebar,
    modelHints,
  };
}

/** Find an already-open tab for the provider, or open one in the first context. */
async function findProviderPage(browser, provider) {
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      if (page.url().includes(provider.origin)) return page;
    }
  }
  const [context] = browser.contexts();
  if (!context) return null;
  const page = await context.newPage();
  await page.goto(provider.defaultUrl, { waitUntil: "domcontentloaded" }).catch(() => {});
  return page;
}

async function captureOne(browser, id) {
  const provider = PROVIDERS[id];
  if (!provider) return { provider: id, error: "unknown provider" };
  const page = await findProviderPage(browser, provider);
  if (!page) return { provider: id, error: "no browser context to inspect" };
  if (!page.url().includes(provider.origin)) {
    await page.goto(provider.defaultUrl, { waitUntil: "domcontentloaded" }).catch(() => {});
  }
  // Best-effort: wait for the configured composer so the DOM has settled.
  const domComposer = provider.selectors.composer.includes(":has-text")
    ? '[contenteditable="true"], textarea'
    : provider.selectors.composer;
  await page.waitForSelector(domComposer, { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(600);
  try {
    const result = await page.evaluate(selectorProbe, provider.selectors);
    return { provider: id, ...result };
  } catch (err) {
    return { provider: id, error: String(err).split("\n")[0] };
  }
}

/** One-glance console summary: configured-selector resolution + top real candidates. */
function printSummary(report) {
  if (report.error) {
    console.log(`\n### ${report.provider} — ERROR: ${report.error}`);
    return;
  }
  console.log(
    `\n### ${report.provider}  (${report.signedIn ? "signed in" : "NOT signed in"})  ${report.url}`,
  );
  console.log("  configured selectors:");
  for (const [role, r] of Object.entries(report.configured)) {
    const mark = r.count > 0 ? "✓" : r.count === 0 ? "✗ (0 matches)" : `– ${r.note ?? "n/a"}`;
    console.log(`    ${role.padEnd(10)} ${mark.padEnd(16)} ${r.selector}`);
  }
  if (report.messages.length > 0) {
    console.log("  message containers present:");
    for (const m of report.messages)
      console.log(`    ${String(m.count).padStart(3)}×  ${m.selector}`);
  }
  if (report.composers.length > 0) {
    const c = report.composers[0];
    console.log(
      `  composer[0]: <${c.tag}> id=${c.id || "-"} testid=${c.testid || "-"} aria="${c.aria}" placeholder="${c.placeholder}"`,
    );
  }
  if (report.modelHints.length > 0) {
    console.log(`  model hints: ${report.modelHints.map((m) => `"${m.text}"`).join(", ")}`);
  }
  console.log(
    `  controls: ${report.controls.length}, sidebar links: ${report.sidebar.convLinkCount}`,
  );
}

async function main() {
  const requested = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const providers = requested.length > 0 ? requested : DEFAULT_PROVIDERS;

  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
  } catch {
    console.error(
      `Could not attach to Chrome on ${CDP_URL}.\nRun \`node dist/bridge.js login\`, sign into the providers, leave Chrome open, then re-run.`,
    );
    process.exit(1);
  }

  console.log(`Capturing live selectors for: ${providers.join(", ")}`);
  const reports = [];
  for (const id of providers) {
    const report = await captureOne(browser, id);
    printSummary(report);
    reports.push(report);
  }

  await mkdir(REPORT_DIR, { recursive: true });
  const reportPath = join(REPORT_DIR, "selectors.json");
  await writeFile(reportPath, `${JSON.stringify(reports, null, 2)}\n`, "utf-8");
  console.log(`\nFull structural report: ${reportPath}`);
  console.log("(recon done — Chrome left running)");
  process.exit(0);
}

await main();
