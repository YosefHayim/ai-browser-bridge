// Records one real run of the bridge for the landing page hero and writes site/hero-run.json.
// Run by hand: node site/record-hero-run.ts
// Needs Chrome signed in to Claude, DeepSeek and Grok, started by `bridge chrome start`,
// or your own Chrome with AI_BROWSER_BRIDGE_BROWSER=my-chrome set.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { getEncoding } from "js-tiktoken";
import { chromium, type Page } from "playwright";

const runFile = promisify(execFile);

const PROMPT = "Which Postgres index fits a 40M-row time series table?";
const PROVIDERS = [
  { id: "claude", label: "Claude", host: "claude.ai", assistantSelector: ".standard-markdown" },
  {
    id: "deepseek",
    label: "DeepSeek",
    host: "chat.deepseek.com",
    assistantSelector: ".ds-markdown",
  },
  { id: "grok", label: "Grok", host: "grok.com", assistantSelector: '[class*="message-bubble"]' },
];
const COMMAND = `bridge ask --provider ${PROVIDERS.map((provider) => provider.id).join(",")} --json "${PROMPT}"`;
const OUTPUT_FILE = new URL("./hero-run.json", import.meta.url);
const CHROME_PROFILE_ACTIVE_PORT = `${homedir()}/Library/Application Support/Google/Chrome/DevToolsActivePort`;
const DEFAULT_DEBUG_URL = "http://127.0.0.1:9222";
const RENDER_WAIT_MS = 60_000;
const STABLE_TEXT_MS = 2_000;
// Step A saves the raw ask output here; step B (the page measuring) reads it, so the prompt is sent once.
// Pass another file with --from <file>. Delete the file to send the prompt again.
const SCRATCH_FOLDER = `${homedir()}/.local/state/agent-scripts`;
const ASK_CACHE_FILE = `${SCRATCH_FOLDER}/hero-ask-raw.json`;
const SCREENSHOT_FOLDER = SCRATCH_FOLDER;

type FanOutTarget = { provider: string; url: string | null };
type FanOutRow = {
  ok: boolean;
  reply?: string;
  error?: string;
  elapsedMs: number;
  target: FanOutTarget | null;
};
type FanOutReport = { taskReports: FanOutRow[] };

const tokenizer = getEncoding("o200k_base");
function countTokens(text: string): number {
  return tokenizer.encode(text, [], []).length;
}

async function readBridgeVersion(): Promise<string> {
  const { stdout } = await runFile("bridge", ["--version"]);
  return stdout.trim();
}

async function runBridgeAsk(): Promise<{ report: FanOutReport; durationMs: number }> {
  const started = Date.now();
  let stdout: string;
  try {
    ({ stdout } = await runFile(
      "bridge",
      ["ask", "--provider", PROVIDERS.map((provider) => provider.id).join(","), "--json", PROMPT],
      { maxBuffer: 64 * 1024 * 1024 },
    ));
  } catch (error) {
    // A partly failed fan-out exits non-zero but still prints its JSON.
    const failedStdout = (error as { stdout?: string }).stdout;
    if (!failedStdout?.includes("{")) throw error;
    stdout = failedStdout;
  }
  const durationMs = Date.now() - started;
  const jsonLine = stdout
    .split("\n")
    .map((line) => line.trim())
    .findLast((line) => line.startsWith("{"));
  if (jsonLine == null) throw new Error(`bridge printed no JSON:\n${stdout}`);
  return { report: JSON.parse(jsonLine) as FanOutReport, durationMs };
}

// Chrome with chrome://inspect remote debugging has no /json/version, so connect by websocket.
function readChromeDebugEndpoint(): string {
  try {
    const [port, browserPath] = readFileSync(CHROME_PROFILE_ACTIVE_PORT, "utf8").split("\n");
    if (port != null && browserPath?.startsWith("/devtools/browser/")) {
      return `ws://127.0.0.1:${port}${browserPath}`;
    }
  } catch {
    // No active-port file: fall through to the classic debug port.
    return DEFAULT_DEBUG_URL;
  }
  return DEFAULT_DEBUG_URL;
}

// The bridge closes its tabs after the ask, so reopen each conversation in a new tab.
async function waitForStableAssistantText(page: Page, selector: string): Promise<void> {
  const deadline = Date.now() + RENDER_WAIT_MS;
  let lastText: string | null = null;
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    const texts = await page.locator(selector).allInnerTexts();
    const text = texts.at(-1) ?? null;
    if (text == null || text.trim() === "" || text !== lastText) {
      lastText = text;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= STABLE_TEXT_MS) {
      return;
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`No stable assistant text for ${selector} within ${RENDER_WAIT_MS}ms.`);
}

async function measurePageHtmlTokens(
  provider: { id: string; assistantSelector: string },
  conversationUrl: string,
): Promise<number> {
  const browser = await chromium.connectOverCDP(readChromeDebugEndpoint());
  try {
    const context = browser.contexts()[0];
    if (context == null) throw new Error("Chrome has no browser context.");
    const page = await context.newPage();
    try {
      await page.goto(conversationUrl, { waitUntil: "load", timeout: RENDER_WAIT_MS });
      await waitForStableAssistantText(page, provider.assistantSelector);
      return countTokens(await page.content());
    } catch (error) {
      try {
        await page.screenshot({ path: `${SCREENSHOT_FOLDER}/hero-${provider.id}-failure.png` });
      } catch (screenshotError) {
        // The screenshot is only a debugging aid; keep the original failure.
        console.error("Could not save the failure screenshot:", screenshotError);
      }
      throw error;
    } finally {
      await page.close();
    }
  } finally {
    // For a CDP connection this drops the Playwright link only; Chrome keeps running.
    await Promise.race([browser.close(), new Promise((done) => setTimeout(done, 5_000))]);
  }
}

const sensitivePatterns = [
  /[\w.+-]+@[\w-]+\.[\w.-]+/,
  /https?:\/\/\S+/,
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
];
function assertReplyIsClean(id: string, replyText: string): void {
  for (const pattern of sensitivePatterns) {
    if (pattern.test(replyText)) {
      throw new Error(`${id} reply matches ${pattern}; review it by hand before saving.`);
    }
  }
}

async function main(): Promise<void> {
  const bridgeVersion = await readBridgeVersion();
  const fromIndex = process.argv.indexOf("--from");
  const cacheFile =
    fromIndex === -1 ? ASK_CACHE_FILE : (process.argv[fromIndex + 1] ?? ASK_CACHE_FILE);
  if (!existsSync(cacheFile)) {
    // Step A: send the prompt once and keep the raw result.
    mkdirSync(SCRATCH_FOLDER, { recursive: true });
    writeFileSync(cacheFile, JSON.stringify(await runBridgeAsk()));
  }
  // Step B: measure the pages from the saved result.
  const { report, durationMs } = JSON.parse(readFileSync(cacheFile, "utf8")) as {
    report: FanOutReport;
    durationMs: number;
  };

  const providers = [];
  for (const provider of PROVIDERS) {
    const row = report.taskReports.find((result) => result.target?.provider === provider.id);
    if (row == null || !row.ok || row.reply == null) {
      throw new Error(`${provider.id} failed: ${row?.error ?? "no result row"}`);
    }
    const conversationUrl = row.target?.url;
    if (conversationUrl == null) throw new Error(`${provider.id} gave no conversation URL.`);
    assertReplyIsClean(provider.id, row.reply);
    providers.push({
      id: provider.id,
      label: provider.label,
      host: provider.host,
      replyText: row.reply,
      replyTokens: countTokens(row.reply),
      pageHtmlTokens: await measurePageHtmlTokens(provider, conversationUrl),
      durationMs: row.elapsedMs,
    });
  }

  const output = {
    recordedAt: new Date().toISOString(),
    bridgeVersion,
    prompt: PROMPT,
    command: COMMAND,
    durationMs,
    tokenizer: "o200k_base",
    providers,
  };
  writeFileSync(OUTPUT_FILE, `${JSON.stringify(output, null, 2)}\n`);
  console.log(
    providers.map((p) => `${p.id}: page ${p.pageHtmlTokens} vs reply ${p.replyTokens}`).join("\n"),
  );
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
