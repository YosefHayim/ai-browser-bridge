#!/usr/bin/env node
/**
 * End-to-end test: launches Chrome with the configured ChatGPT profile,
 * sends 3 prompts to ChatGPT, captures responses.
 */
import { BrowserManager } from "../src/browser/manager.ts";
import { injectPrompt, waitForResponse, captureLastResponse } from "../src/browser/chatgpt-page.ts";
import { CHROME_ROOT } from "../src/browser/profiles.ts";

const PROFILE = process.env.CHROME_PROFILE ?? "Default";
const PROMPTS = [
  "Say exactly: BRIDGE_TEST_RESPONSE_1",
  "Say exactly: BRIDGE_TEST_RESPONSE_2",
  "Say exactly: BRIDGE_TEST_RESPONSE_3",
];

async function main() {
  const browser = new BrowserManager();
  console.log("Launching Chrome with profile:", PROFILE);

  let page;
  try {
    page = await browser.launch(CHROME_ROOT, PROFILE);
  } catch (err) {
    console.error("Failed to launch browser:", err);
    process.exit(1);
  }

  console.log("Page URL:", page.url());
  console.log("Waiting for ChatGPT to load...\n");

  // Wait for ChatGPT to fully load
  await page.waitForSelector("#prompt-textarea", { timeout: 30_000 });
  await new Promise(r => setTimeout(r, 3000));

  const results = [];

  for (let i = 0; i < PROMPTS.length; i++) {
    const prompt = PROMPTS[i];
    console.log(`\n=== Prompt ${i + 1} ===`);
    console.log(`Sending: "${prompt}"`);

    try {
      await injectPrompt(page, prompt);
      console.log("Prompt injected. Waiting for response...");
      await waitForResponse(page, 60_000);
      const response = await captureLastResponse(page);
      console.log(`Response (${response.length} chars):`);
      console.log(response.slice(0, 200));
      results.push({ prompt, response, ok: true });
    } catch (err) {
      console.error(`Error on prompt ${i + 1}:`, err);
      results.push({ prompt, response: "", ok: false, error: String(err) });
    }
  }

  console.log("\n\n=== RESULTS ===");
  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"} | ${r.prompt} -> ${r.response.slice(0, 100)}`);
  }

  const passed = results.filter(r => r.ok).length;
  console.log(`\n${passed}/${results.length} prompts succeeded`);

  await browser.close();
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
