#!/usr/bin/env node
// Dev-only targeted probe: pin the exact DOM container a provider renders its
// assistant reply into, when the generic recon can't surface a clean selector.
//
// It attaches to the warm bridge Chrome over CDP (:9222), finds the provider tab,
// locates the deepest element whose text contains a known needle (default "pong",
// the verify prompt's reply) while EXCLUDING the user message and composer, and
// prints that element's ancestor chain (tag / id / class / data-testid). Read the
// chain to choose a stable assistant selector for src/config/providersConfig.ts.
//
// READ-ONLY: queries the DOM only, never clicks or types. Run AFTER a reply exists
// on the tab (e.g. after `node src/scripts/dev/verifyProviders.mjs`):
//
//   node src/scripts/dev/probeReplyContainer.mjs claude
//   node src/scripts/dev/probeReplyContainer.mjs perplexity --needle=pong
import { chromium } from "playwright";

const CDP_URL = "http://127.0.0.1:9222";

// origin + the user-message selector to exclude, per provider.
const PROVIDERS = {
  claude: { origin: "claude.ai", user: '[data-testid="user-message"]' },
  perplexity: { origin: "perplexity.ai", user: '[class*="query"], [class*="Query"]' },
  deepseek: { origin: "chat.deepseek.com", user: '[class*="fbb737a4"]' },
  grok: { origin: "grok.com", user: '[data-testid="user-message"]' },
  gemini: { origin: "gemini.google.com", user: "user-query, .user-query" },
  chatgpt: { origin: "chatgpt.com", user: '[data-message-author-role="user"]' },
};

function replyProbe(opts) {
  const clip = (s, n = 120) => (s || "").replace(/\s+/g, " ").trim().slice(0, n);
  const desc = (el) => ({
    tag: el.tagName.toLowerCase(),
    id: el.id || "",
    cls: clip(typeof el.className === "string" ? el.className : "", 140),
    testid: el.getAttribute("data-testid") || "",
    role: el.getAttribute("role") || "",
  });
  const needle = opts.needle.toLowerCase();
  const inUser = (el) => Boolean(opts.userSelector && el.closest(opts.userSelector));
  const inComposer = (el) => Boolean(el.closest("[contenteditable], textarea"));
  const hits = [...document.querySelectorAll("main *, body *")].filter((el) => {
    if (inUser(el) || inComposer(el)) return false;
    const text = (el.innerText || "").trim().toLowerCase();
    if (!text.includes(needle)) return false;
    return ![...el.children].some((c) => (c.innerText || "").toLowerCase().includes(needle));
  });
  const last = hits.at(-1);
  if (!last) return { found: false, note: "no non-user element contains the needle" };
  const chain = [];
  let cur = last;
  for (let i = 0; i < 8 && cur && cur.tagName !== "BODY"; i += 1) {
    chain.push(desc(cur));
    cur = cur.parentElement;
  }
  return { found: true, needle: opts.needle, hitCount: hits.length, chain };
}

async function findPage(browser, origin) {
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      if (page.url().includes(origin)) return page;
    }
  }
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const ids = args.filter((a) => !a.startsWith("--"));
  const needle = (args.find((a) => a.startsWith("--needle=")) ?? "--needle=pong").split("=")[1];
  if (ids.length === 0) {
    console.error(
      "Usage: node src/scripts/dev/probeReplyContainer.mjs <provider…> [--needle=pong]",
    );
    process.exit(1);
  }
  const browser = await chromium.connectOverCDP(CDP_URL);
  for (const id of ids) {
    const provider = PROVIDERS[id];
    if (!provider) {
      console.log(`\n### ${id}: unknown provider`);
      continue;
    }
    const page = await findPage(browser, provider.origin);
    if (!page) {
      console.log(`\n### ${id}: no ${provider.origin} tab open`);
      continue;
    }
    const result = await page
      .evaluate(replyProbe, { needle, userSelector: provider.user })
      .catch((err) => ({ found: false, note: String(err).split("\n")[0] }));
    console.log(`\n### ${id}  ${page.url().replace(/[0-9a-f-]{12,}/gi, "<id>")}`);
    if (!result.found) {
      console.log(`  ${result.note}`);
      continue;
    }
    console.log(
      `  needle "${result.needle}" — ${result.hitCount} candidate(s). Reply container chain:`,
    );
    result.chain.forEach((d, i) => {
      const parts = [
        `<${d.tag}>`,
        d.id && `#${d.id}`,
        d.testid && `[data-testid="${d.testid}"]`,
        d.role && `[role=${d.role}]`,
        d.cls && `.${d.cls.split(" ").filter(Boolean).slice(0, 4).join(".")}`,
      ].filter(Boolean);
      console.log(`    ${i === 0 ? "reply→" : "  ↑  "} ${parts.join(" ")}`);
    });
  }
  process.exit(0);
}

await main();
