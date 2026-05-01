#!/usr/bin/env node
import { chromium } from "playwright";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { homedir } from "node:os";

const CHROME_ROOT = join(homedir(), "Library/Application Support/Google/Chrome");
const CHROME_BIN = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const lockFile = join(CHROME_ROOT, "SingletonLock");

// Kill Chrome if running
try { execFileSync("pkill", ["-x", "Google Chrome"], { timeout: 5000 }); } catch {}
await new Promise(r => setTimeout(r, 2000));
if (existsSync(lockFile)) { try { unlinkSync(lockFile); } catch {} }

// Create bridge dir
const bridgeDir = join(tmpdir(), "chatgpt-bridge-chrome");
if (existsSync(bridgeDir)) { try { rmSync(bridgeDir, { recursive: true, force: true }); } catch {} }
mkdirSync(bridgeDir, { recursive: true });
for (const entry of readdirSync(CHROME_ROOT)) {
  try { symlinkSync(join(CHROME_ROOT, entry), join(bridgeDir, entry)); } catch {}
}

// Launch Chrome manually (no automation flags)
const child = spawn(CHROME_BIN, [
  `--user-data-dir=${bridgeDir}`,
  "--profile-directory=Profile 4",
  "--remote-debugging-port=9222",
  "--no-first-run",
  "--no-default-browser-check",
  "https://chatgpt.com",
], { detached: true, stdio: "ignore" });
child.unref();

// Wait for debug port
console.log("Waiting for debug port...");
for (let i = 0; i < 60; i++) {
  try {
    const resp = await fetch("http://localhost:9222/json/version");
    if (resp.ok) { console.log("Debug port ready!"); break; }
  } catch {}
  await new Promise(r => setTimeout(r, 500));
}

const browser = await chromium.connectOverCDP("http://localhost:9222");
const context = browser.contexts()[0];
const page = context.pages().find(p => p.url().includes("chatgpt.com")) || context.pages()[0];

console.log("URL:", page.url());

// Wait for ChatGPT to load
console.log("Waiting for ChatGPT to load...");
await page.waitForSelector("#prompt-textarea", { timeout: 30_000 });
await new Promise(r => setTimeout(r, 3000));
console.log("ChatGPT loaded!");

// Type prompt
const input = page.locator("#prompt-textarea").first();
await input.click();
await input.fill("Say exactly: BRIDGE_TEST_1");
await input.dispatchEvent("input");

// Wait for send button
const sendBtn = page.locator('button[data-testid="send-button"]').first();
await sendBtn.waitFor({ state: "visible", timeout: 10_000 });
console.log("Send button found, clicking...");
await sendBtn.click();

console.log("Prompt sent. Waiting for response...");

// Wait for response to appear
await page.waitForSelector('[data-message-author-role="assistant"]', { timeout: 60_000 });
console.log("Response element found!");

// Wait for streaming to complete (stop button disappears)
try {
  await page.locator('button[aria-label="Stop generating"]').waitFor({ state: "visible", timeout: 5_000 });
  console.log("Streaming started, waiting for completion...");
  await page.locator('button[aria-label="Stop generating"]').waitFor({ state: "hidden", timeout: 120_000 });
} catch {
  console.log("No streaming indicator found (might be done)");
}

// Wait extra for DOM to settle
await new Promise(r => setTimeout(r, 2000));

// Get response
const responses = await page.locator('[data-message-author-role="assistant"]').all();
console.log(`Found ${responses.length} assistant response(s)`);
if (responses.length > 0) {
  const last = responses[responses.length - 1];
  const text = await last.innerText();
  console.log(`Last response (${text.length} chars):`, text.slice(0, 500));
}

await page.screenshot({ path: "/tmp/chatgpt-test-result.png" });
console.log("Screenshot: /tmp/chatgpt-test-result.png");

await browser.close();
process.exit(0);
