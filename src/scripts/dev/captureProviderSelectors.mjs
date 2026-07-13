#!/usr/bin/env node
// Dev-only selector recon for the web-chat providers.
//
// Attaches to the warm bridge Chrome over CDP (:9222) and, for each provider,
// validates the selectors declared in src/config/providersConfig.ts against the
// REAL signed-in DOM, then discovers the full FUNCTIONAL surface each platform
// exposes — composer, assistant, model picker, new-chat, attach, sidebar history,
// voice / web-search toggles, regenerate, settings — plus (read-only) whether the
// provider offers a custom MCP connector we could set up. The configured selectors
// are flagged LIVE-VERIFY in the source; this is that verification.
//
// STRICTLY READ-ONLY: it navigates and queries the DOM (querySelectorAll /
// attributes) and never clicks, types, submits, or opens a menu, so it cannot
// mutate any account. Connector detection opens a THROWAWAY tab, reads the settings
// page, and closes it — it never clicks "Add" / "Connect" / "Save". It records
// STRUCTURE only (tags, classes, data-testids, aria-labels, counts) — never message
// text or conversation titles — and redacts ids out of URLs. Run AFTER signing into
// each provider (and ideally after a prompt exists, so an assistant message matches):
//
//   node dist/bridge.js chrome start --provider claude  # sign in if needed
//   node src/scripts/dev/verifyProviders.mjs            # leaves a reply on each tab
//   node src/scripts/dev/captureProviderSelectors.mjs   # then capture selectors
//
// Output is written under downloads/ (gitignored) — nothing enters git.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
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
      composer: '[data-testid="chat-input"], div[contenteditable="true"]',
      assistant: ".standard-markdown",
      user: '[data-testid="user-message"]',
      stop: 'button[aria-label="Stop response"]',
      send: 'button[aria-label="Send message"]',
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
      composer: '[aria-label="Ask Grok anything"], div.tiptap.ProseMirror, textarea',
      assistant: '[class*="message-bubble"]',
      stop: 'button[aria-label*="Stop"]',
      signedOut: 'button:has-text("Sign in")',
    },
  },
  perplexity: {
    origin: "perplexity.ai",
    defaultUrl: "https://www.perplexity.ai/",
    selectors: {
      composer: '#ask-input, textarea, div[contenteditable="true"]',
      assistant: ".prose",
      stop: 'button[aria-label*="Stop"]',
      signedOut: 'button:has-text("Sign Up")',
    },
  },
  flow: {
    origin: "labs.google",
    defaultUrl: "https://labs.google/fx/tools/flow",
    // The prompt box, submit, and clips only exist inside a project editor, so recon
    // steps into the first existing project (or a new one) before probing.
    enterEditor: true,
    selectors: {
      composer: '[data-slate-editor="true"], [role="textbox"][contenteditable="true"]',
      assistant: "video",
      stop: 'button[aria-label*="Cancel" i], button[aria-label*="Stop" i]',
      send: 'button:has-text("Create"):not([aria-haspopup])',
      signedOut: 'a[href*="accounts.google.com"], button:has-text("Sign in")',
    },
  },
};

// Read-only connector-settings URLs to probe for custom MCP support. ChatGPT already
// has an implemented flow, so it is not re-probed here; the rest are the unknowns.
const CONNECTOR_SETTINGS = {
  claude: "https://claude.ai/settings/connectors",
  perplexity: "https://www.perplexity.ai/settings/connectors",
  gemini: "https://gemini.google.com/apps",
};

const DEFAULT_PROVIDERS = ["claude", "deepseek", "grok", "perplexity", "gemini", "flow"];

// dev script lives at src/scripts/dev/ — three levels up is the repo root.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const REPORT_DIR = join(REPO_ROOT, "downloads", "verify-providers");

/**
 * DOM probe serialized into the page. Given the configured selector set, it reports
 * whether each resolves and enumerates the real composer / assistant / functional /
 * control / sidebar / model candidates. Pure structure — no message text.
 */
const selectorProbe = (configured) => {
  const clip = (s, n = 60) => (s || "").replace(/\s+/g, " ").trim().slice(0, n);
  const clsOf = (el) => clip(typeof el.className === "string" ? el.className : "", 80);
  const redact = (s) => (s || "").replace(/[0-9a-f]{8,}|[0-9a-f-]{16,}/gi, "<id>");

  // Prefer a stable, human-meaningful selector for an element: testid > aria > id > class.
  const bestSelector = (el) => {
    const tid = el.getAttribute("data-testid");
    if (tid) return `[data-testid="${tid}"]`;
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
      best: bestSelector(el),
    }));

  // Candidate assistant/user message containers, by the attribute patterns providers use.
  const messageSelectors = [
    "[data-message-author-role]",
    '[data-testid="user-message"]',
    '[data-testid*="message"]',
    ".standard-markdown",
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

  // Categorize every interactive control by the behavior it drives — this is the
  // functional-UI map each generic adapter method (sidebar / model / attach / …) needs.
  const patterns = {
    newChat: /new chat|new conversation|new thread|start new/i,
    attach: /attach|upload|add photos|add files|add from/i,
    model: /model select|choose model|switch model|\bmodel\b/i,
    send: /send message|^send$|submit(?! feedback)/i,
    stop: /stop generat|stop response|stop streaming|^stop$/i,
    voice: /voice mode|dictate|microphone|^mic$/i,
    webSearch: /web search|search the web|deep research|deepsearch|deepthink|^research$|sources/i,
    regenerate: /regenerate|try again|^retry$/i,
    edit: /edit message|edit prompt|^edit$/i,
    settings: /^settings$|open settings|account settings/i,
    share: /share chat|share conversation|^share$/i,
  };
  const functional = {};
  for (const name of Object.keys(patterns)) functional[name] = [];
  const controlEls = document.querySelectorAll(
    'button, [role="button"], a[href], input[type="file"]',
  );
  for (const el of controlEls) {
    const aria = el.getAttribute("aria-label") || "";
    const testid = el.getAttribute("data-testid") || "";
    const text = clip(el.textContent, 40);
    const href = el.getAttribute("href") || "";
    const hay = `${aria} ${testid} ${text} ${href}`;
    for (const [name, re] of Object.entries(patterns)) {
      if (functional[name].length >= 4 || !re.test(hay)) continue;
      const selector = bestSelector(el);
      if (functional[name].some((c) => c.selector === selector)) continue;
      functional[name].push({
        selector,
        tag: el.tagName.toLowerCase(),
        aria: clip(aria),
        testid,
        text,
      });
    }
  }
  for (const el of document.querySelectorAll('input[type="file"]')) {
    const selector = bestSelector(el);
    if (!functional.attach.some((c) => c.selector === selector))
      functional.attach.push({
        selector,
        tag: "input",
        aria: "",
        testid: el.getAttribute("data-testid") || "",
        text: "[file input]",
      });
  }

  const interesting =
    /send|stop|regenerate|new chat|new conversation|model|attach|voice|mic|search|research|submit|connector|settings/i;
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
      best: bestSelector(el),
      disabled: el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true",
    });
    if (controls.length >= 30) break;
  }

  const sidebarLinks = [
    ...document.querySelectorAll('a[href*="/c/"], a[href*="/chat/"], nav a[href], aside a[href]'),
  ];
  const sidebar = {
    convLinkCount: sidebarLinks.length,
    itemSelector: sidebarLinks[0] ? bestSelector(sidebarLinks[0]) : "",
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
      best: bestSelector(el),
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
    functional,
    controls,
    sidebar,
    modelHints,
  };
};

/**
 * Read-only connector-settings probe, serialized into a throwaway settings tab.
 * Detects whether a "custom MCP connector" affordance exists and captures the
 * trigger selector — WITHOUT clicking it (so no form is opened and nothing saves).
 */
const connectorProbe = () => {
  const clip = (s, n = 60) => (s || "").replace(/\s+/g, " ").trim().slice(0, n);
  const best = (el) => {
    const tid = el.getAttribute("data-testid");
    if (tid) return `[data-testid="${tid}"]`;
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
  const addRe =
    /add custom connector|custom connector|add connector|connect app|add integration|remote mcp|mcp server|add extension|browse connectors|advanced settings/i;
  const triggers = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('button, [role="button"], a[href]')) {
    const hay = `${el.getAttribute("aria-label") || ""} ${el.getAttribute("data-testid") || ""} ${clip(el.textContent, 50)}`;
    if (!addRe.test(hay)) continue;
    const selector = best(el);
    if (seen.has(selector)) continue;
    seen.add(selector);
    triggers.push({
      selector,
      tag: el.tagName.toLowerCase(),
      text: clip(el.textContent, 50),
      aria: clip(el.getAttribute("aria-label") || ""),
      testid: el.getAttribute("data-testid") || "",
    });
    if (triggers.length >= 8) break;
  }
  const fields = [...document.querySelectorAll("input, textarea")]
    .filter((el) =>
      /url|name|endpoint|server|mcp/i.test(
        `${el.getAttribute("name") || ""} ${el.getAttribute("placeholder") || ""} ${el.id}`,
      ),
    )
    .slice(0, 6)
    .map((el) => ({
      selector: best(el),
      name: el.getAttribute("name") || "",
      id: el.id || "",
      placeholder: clip(el.getAttribute("placeholder") || ""),
    }));
  const body = document.body ? document.body.innerText.slice(0, 20000) : "";
  const mentionsMcp = /\bMCP\b|custom connector|remote server|connector url/i.test(body);
  return {
    url: (location.origin + location.pathname).replace(/[0-9a-f]{8,}|[0-9a-f-]{16,}/gi, "<id>"),
    available: triggers.length > 0 || mentionsMcp,
    mentionsMcp,
    triggers,
    fields,
  };
};

/** Find an already-open tab for the provider, or open one in the first context. */
const findProviderPage = async (browser, provider) => {
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
};

/** Open a throwaway tab on the connector-settings URL, read it, and close it. */
const probeConnectorSettings = async (browser, url) => {
  const [context] = browser.contexts();
  if (!context) return { available: false, note: "no browser context" };
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(1_800);
    return await page
      .evaluate(connectorProbe)
      .catch((err) => ({ available: false, note: String(err).split("\n")[0] }));
  } finally {
    await page.close().catch(() => {});
  }
};

/**
 * Step into a Flow project editor (where the composer/submit/clips live) by opening the
 * first existing project link, falling back to the "New project" button. Read-only:
 * navigation and a single click on an existing project — never a generate/submit.
 */
const enterFlowEditor = async (page) => {
  if (page.url().includes("/project/")) return;
  const link = await page
    .locator('a[href*="/tools/flow/project"]')
    .first()
    .getAttribute("href")
    .catch(() => null);
  if (link) {
    const url = link.startsWith("http") ? link : `https://labs.google${link}`;
    await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForTimeout(4_500);
    return;
  }
  const newProject = page.locator('button:has-text("New project")').first();
  if (await newProject.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await newProject.click().catch(() => {});
    await page.waitForTimeout(4_500);
  }
};

const captureOne = async (browser, id) => {
  const provider = PROVIDERS[id];
  if (!provider) return { provider: id, error: "unknown provider" };
  const page = await findProviderPage(browser, provider);
  if (!page) return { provider: id, error: "no browser context to inspect" };
  if (!page.url().includes(provider.origin)) {
    await page.goto(provider.defaultUrl, { waitUntil: "domcontentloaded" }).catch(() => {});
  }
  if (provider.enterEditor) await enterFlowEditor(page);
  // Best-effort: wait for the configured composer so the DOM has settled.
  const domComposer = provider.selectors.composer.includes(":has-text")
    ? '[contenteditable="true"], textarea'
    : provider.selectors.composer;
  await page.waitForSelector(domComposer, { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(600);
  let surface;
  try {
    surface = await page.evaluate(selectorProbe, provider.selectors);
  } catch (err) {
    return { provider: id, error: String(err).split("\n")[0] };
  }
  const report = { provider: id, ...surface };
  if (id === "chatgpt") {
    report.connector = { available: true, note: "implemented flow — setupMcpConnectorInChatGpt" };
  } else if (CONNECTOR_SETTINGS[id]) {
    report.connector = await probeConnectorSettings(browser, CONNECTOR_SETTINGS[id]);
  }
  return report;
};

/** One-glance console summary: configured-selector resolution + functional map + connector. */
const printSummary = (report) => {
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
  const funcNames = Object.entries(report.functional ?? {}).filter(([, v]) => v.length > 0);
  if (funcNames.length > 0) {
    console.log("  functional UI:");
    for (const [name, hits] of funcNames) console.log(`    ${name.padEnd(11)} ${hits[0].selector}`);
  }
  if (report.composers.length > 0) {
    const c = report.composers[0];
    console.log(`  composer[0]: ${c.best}  (placeholder="${c.placeholder}")`);
  }
  if (report.sidebar?.itemSelector)
    console.log(
      `  sidebar: ${report.sidebar.convLinkCount} links via ${report.sidebar.itemSelector}`,
    );
  if (report.modelHints.length > 0)
    console.log(`  model: "${report.modelHints[0].text}" via ${report.modelHints[0].best}`);
  if (report.connector) {
    const c = report.connector;
    const mark = c.available ? "✓ available" : "✗ none";
    const trig = c.triggers?.[0]?.selector ? ` — trigger ${c.triggers[0].selector}` : "";
    console.log(`  MCP connector: ${mark}${c.note ? ` (${c.note})` : ""}${trig}`);
  }
};

const main = async () => {
  const requested = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const providers = requested.length > 0 ? requested : DEFAULT_PROVIDERS;

  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
  } catch {
    console.error(
      `Could not attach to Chrome on ${CDP_URL}.\nRun \`node dist/bridge.js chrome start\`, sign into providers if needed, leave Chrome open, then re-run.`,
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
};

await main();
