// Read-only recon: dump the real state of the ChatGPT tab on a debug port so we can
// tell apart "signed-in app shell (composer present)", "logged-out landing",
// "Cloudflare/verify interstitial", and "error/blank" states. Prints title, trimmed
// body text, visible button/link labels, and key selector hits.
import { chromium } from "playwright";

const port = process.argv[2] ?? "9222";
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

const state = await page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const bodyText = (document.body?.innerText ?? "").replace(/\s+/g, " ").trim();
  const labels = Array.from(document.querySelectorAll("button, a"))
    .map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim())
    .filter((t) => t.length > 0 && t.length < 40)
    .slice(0, 25);
  return {
    url: location.href,
    title: document.title,
    readyState: document.readyState,
    bodyLen: bodyText.length,
    bodyHead: bodyText.slice(0, 400),
    promptTextarea: Boolean(q("#prompt-textarea")),
    proseMirror: Boolean(q(".ProseMirror")),
    sendButton: Boolean(q('button[data-testid="send-button"], button[aria-label*="Send" i]')),
    attachButton: Boolean(q('button[aria-label*="Attach" i]')),
    cloudflare:
      /just a moment|verify you are human|checking your browser|needs to review the security/i.test(
        bodyText,
      ),
    loginButtons: Array.from(document.querySelectorAll("button, a"))
      .map((el) => (el.textContent ?? "").trim())
      .filter((t) => /log ?in|sign ?up|get started/i.test(t))
      .slice(0, 5),
    labels,
  };
});

console.log(JSON.stringify({ ok: true, port, ...state }, null, 2));
await browser.close();
