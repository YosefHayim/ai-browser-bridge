// Recover a ChatGPT tab stuck on an upstream/gateway error page: reload chatgpt.com/
// and wait for the signed-in composer (#prompt-textarea) to render. Reports the final
// state so a batch run can proceed only once the composer is actually back.
import { chromium } from "playwright";

const port = process.argv[2] ?? "9222";
const maxAttempts = Number(process.argv[3] ?? 3);
const perWaitMs = Number(process.argv[4] ?? 25000);
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
let page = null;
for (const context of browser.contexts()) {
  for (const p of context.pages()) {
    if (p.url().includes("chatgpt.com")) {
      page = p;
      break;
    }
  }
  if (page) break;
}
if (!page) {
  console.log(JSON.stringify({ ok: false, port, reason: "no chatgpt tab" }));
  await browser.close();
  process.exit(0);
}

let composer = false;
let bodyHead = "";
for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  try {
    await page.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded", timeout: 30000 });
  } catch {
    // ignore nav timeout; we re-check the DOM below
  }
  try {
    await page.waitForSelector("#prompt-textarea", { timeout: perWaitMs });
    composer = true;
  } catch {
    composer = false;
  }
  bodyHead = await page
    .evaluate(() => (document.body?.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 160))
    .catch(() => "");
  if (composer) break;
  await page.waitForTimeout(4000);
}

const info = await page.evaluate(() => ({
  url: location.href,
  hasComposer: Boolean(document.querySelector("#prompt-textarea")),
  hasProjectsHeading: /(^|\n)\s*Projects\s*($|\n)/.test(document.body?.innerText ?? ""),
  planHint:
    (document.body?.innerText ?? "").match(/\b(Plus|Pro|Team|Free|Enterprise)\b/)?.[0] ?? null,
}));

console.log(JSON.stringify({ ok: true, port, composer, bodyHead, ...info }, null, 2));
await browser.close();
