// Read-only recon: connect to the bridge's Brave over CDP and report ChatGPT
// login state + active account, so we know whether we can generate before firing.
// Run from inside the bridge repo so ESM resolves the local playwright install.
import { chromium } from "playwright";

const CDP_URL = "http://127.0.0.1:9222";

const browser = await chromium.connectOverCDP(CDP_URL);
const contexts = browser.contexts();
let target = null;
for (const context of contexts) {
  for (const page of context.pages()) {
    if (page.url().includes("chatgpt.com") || page.url().includes("openai.com")) {
      target = page;
      break;
    }
  }
  if (target) break;
}

if (!target) {
  console.log(JSON.stringify({ ok: false, reason: "no chatgpt tab" }));
  await browser.close();
  process.exit(0);
}

const info = await target.evaluate(() => {
  const hasComposer = Boolean(document.querySelector("#prompt-textarea"));
  const bodyText = document.body?.innerText ?? "";
  const loginWall = /log in|sign up|welcome back/i.test(bodyText) && !hasComposer;
  // Try to surface the active account email if the account menu rendered it anywhere.
  const emailMatch = bodyText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return {
    url: location.href,
    title: document.title,
    hasComposer,
    loginWall,
    email: emailMatch ? emailMatch[0] : null,
    firstChars: bodyText.slice(0, 200).replace(/\s+/g, " ").trim(),
  };
});

console.log(JSON.stringify({ ok: true, ...info }, null, 2));
await browser.close();
