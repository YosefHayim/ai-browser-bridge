// Read-only recon: report which ChatGPT account a given debug port is signed into,
// so a parallel two-account setup (e.g. Brave on 9223 + Chrome on 9222) can be verified
// as two DIFFERENT accounts before spending image-cap budget. Reports login state, any
// visible account email, workspace/plan hints, and whether Projects exist in the sidebar.
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

const info = await page.evaluate(() => {
  const bodyText = document.body?.innerText ?? "";
  const hasComposer = Boolean(document.querySelector("#prompt-textarea"));
  const loginWall = /log in|sign up|welcome back/i.test(bodyText) && !hasComposer;
  // Account email, if the account button/menu rendered it into the DOM anywhere.
  const emailMatch = bodyText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  // Plan hint: Plus/Pro/Team badges appear in the sidebar/account area on paid seats.
  const planMatch = bodyText.match(/\b(Plus|Pro|Team|Free|Enterprise)\b/);
  // Projects: paid workspaces show a "Projects" sidebar section with project links.
  const projectLinks = Array.from(document.querySelectorAll('a[href*="/g/g-p-"]')).map((a) =>
    (a.textContent ?? "").trim(),
  );
  const hasProjectsHeading = /(^|\n)\s*Projects\s*($|\n)/.test(bodyText);
  return {
    url: location.href,
    hasComposer,
    loginWall,
    email: emailMatch ? emailMatch[0] : null,
    planHint: planMatch ? planMatch[0] : null,
    hasProjectsHeading,
    projectCount: projectLinks.length,
    sampleProjects: projectLinks.slice(0, 5),
  };
});

console.log(JSON.stringify({ ok: true, port, ...info }, null, 2));
await browser.close();
