#!/usr/bin/env node
// Dev-only recon: open a project's options on /projects, click an action ("Project settings" or
// "Delete project"), and dump the resulting dialog (inputs with values, buttons, text) so we can
// build rename/delete. Read-only: Escapes out, never saves or confirms.
//
//   node src/scripts/dev/probeProjectMenu.mjs [projectName] [settings|delete]
//
import { chromium } from "playwright";

const CDP_URL = "http://127.0.0.1:9222";
const PROJECT = process.argv[2] || "Errands";
const ACTION = process.argv[3] === "delete" ? "Delete project" : "Project settings";

const dumpDialog = (page) =>
  page.evaluate(() => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const dialog =
      document.querySelector('[role="dialog"], [data-radix-popper-content-wrapper]') ||
      document.body;
    const inputs = Array.from(dialog.querySelectorAll("input, textarea")).map((i) => ({
      tag: i.tagName.toLowerCase(),
      name: i.getAttribute("name"),
      placeholder: i.getAttribute("placeholder"),
      value: i.value,
      ariaLabel: i.getAttribute("aria-label"),
    }));
    const buttons = Array.from(dialog.querySelectorAll("button")).map((b) => ({
      text: norm(b.textContent),
      ariaLabel: b.getAttribute("aria-label"),
      testid: b.getAttribute("data-testid"),
    }));
    return { text: norm(dialog.textContent).slice(0, 220), inputs, buttons };
  });

const main = async () => {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  let page = context.pages().find((p) => p.url().includes("chatgpt.com"));
  if (!page) page = await context.newPage();
  await page.goto("https://chatgpt.com/projects", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.bringToFront();

  const optBtn = page.getByRole("button", { name: `Open project options for ${PROJECT}` }).first();
  if ((await optBtn.count()) === 0) {
    console.log("project options button not found");
    await browser.close();
    return;
  }
  await optBtn.dispatchEvent("pointerdown", { button: 0, isPrimary: true, pointerType: "mouse" });
  await page.waitForTimeout(600);
  const item = page.getByRole("menuitem", { name: ACTION }).first();
  console.log(`clicking "${ACTION}" (visible: ${await item.isVisible().catch(() => false)})`);
  await item.click().catch(() => {});
  await page.waitForTimeout(1200);
  console.log(`dialog after "${ACTION}":\n${JSON.stringify(await dumpDialog(page), null, 2)}`);

  await page.keyboard.press("Escape").catch(() => {});
  await page.keyboard.press("Escape").catch(() => {});
  await browser.close();
};

await main();
