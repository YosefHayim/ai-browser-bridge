// Read-mostly recon for the ChatGPT "New project" creation flow, which drifted (createProject
// timed out waiting for input[name="projectName"]). The sidebar "New project" is a tiny
// hover-revealed trailing button that overlapping sidebar links intercept, so a Playwright click
// lands on the wrong element. This probe enumerates every "New project" affordance, then dispatches
// a direct DOM .click() (bypassing pointer interception) and polls for the resulting modal/inputs so
// we can re-derive the name-input + submit selectors. Escape after capture so no junk project sticks.
import { chromium } from "playwright";

const port = process.argv[2] ?? "9223";
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);

const contexts = browser.contexts();
let page = null;
for (const context of contexts) {
  for (const p of context.pages()) {
    if (p.url().includes("chatgpt.com")) {
      page = p;
      break;
    }
  }
  if (page) break;
}
if (!page) {
  const context = contexts[0];
  page = context ? await context.newPage() : await browser.newPage();
}

await page.goto("https://chatgpt.com/projects", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);

// 1) Enumerate every "New project" affordance.
const affordances = await page.evaluate(() => {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  return Array.from(document.querySelectorAll('[aria-label="New project"], button'))
    .filter(
      (el) =>
        /new project/i.test(el.getAttribute("aria-label") || "") ||
        /^new project$/i.test(clean(el.textContent)),
    )
    .map((el) => {
      const r = el.getBoundingClientRect();
      return {
        label: el.getAttribute("aria-label") || "",
        text: clean(el.textContent).slice(0, 24),
        cls: (el.className || "").toString().slice(0, 60),
        inNav: !!el.closest("nav"),
        rect: {
          x: Math.round(r.x),
          y: Math.round(r.y),
          w: Math.round(r.width),
          h: Math.round(r.height),
        },
      };
    });
});
console.log("=== 'New project' affordances ===");
console.log(JSON.stringify(affordances, null, 2));

// 2) DOM-click: prefer a non-nav (main content) button; fall back to the first one.
const clickResult = await page.evaluate(() => {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const all = Array.from(document.querySelectorAll('[aria-label="New project"], button')).filter(
    (el) =>
      /new project/i.test(el.getAttribute("aria-label") || "") ||
      /^new project$/i.test(clean(el.textContent)),
  );
  const target = all.find((el) => !el.closest("nav")) || all[0];
  if (!target) return "none";
  target.click();
  return target.closest("nav") ? "clicked-nav" : "clicked-main";
});
console.log("\nDOM-click:", clickResult);

// 3) Poll up to 5s for a modal/dialog carrying a text input.
let found = null;
for (let i = 0; i < 16; i += 1) {
  await page.waitForTimeout(320);
  found = await page.evaluate(() => {
    const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
    const dialogs = Array.from(
      document.querySelectorAll(
        '[role="dialog"], [aria-modal="true"], [data-radix-popper-content-wrapper]',
      ),
    );
    for (const d of dialogs) {
      const inputs = Array.from(d.querySelectorAll("input, textarea, [contenteditable='true']"));
      const txt = clean(d.textContent);
      if (inputs.length > 0 && /project|name/i.test(txt)) {
        return {
          text: txt.slice(0, 140),
          inputs: inputs.map((el) => ({
            tag: el.tagName.toLowerCase(),
            name: el.getAttribute("name") || "",
            placeholder: el.getAttribute("placeholder") || "",
            ariaLabel: el.getAttribute("aria-label") || "",
            editable: el.getAttribute("contenteditable") || "",
          })),
          buttons: Array.from(d.querySelectorAll("button"))
            .map((b) => clean(b.textContent).slice(0, 24))
            .filter(Boolean),
          html: d.outerHTML.slice(0, 700),
        };
      }
    }
    return null;
  });
  if (found) {
    console.log(`\n=== MODAL FOUND after ${(i + 1) * 320}ms ===`);
    console.log(JSON.stringify(found, null, 2));
    break;
  }
}
if (!found) {
  const dump = await page.evaluate(() => {
    const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
    return {
      url: location.href,
      visibleInputs: Array.from(
        document.querySelectorAll("input, textarea, [contenteditable='true']"),
      )
        .filter((el) => el.offsetParent || el.getClientRects().length)
        .map((el) => ({
          name: el.getAttribute("name") || "",
          placeholder: el.getAttribute("placeholder") || "",
          ariaLabel: el.getAttribute("aria-label") || "",
        })),
      heading: clean(document.querySelector("h1, h2, [role='heading']")?.textContent || ""),
    };
  });
  console.log("\n=== NO MODAL WITH INPUT — state ===");
  console.log(JSON.stringify(dump, null, 2));
}

await page.keyboard.press("Escape").catch(() => {});
await browser.close();
