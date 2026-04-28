import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium, type Browser, type BrowserContext, type Page, type Response } from "playwright";
import type { Conversation } from "../types/types.ts";

const DEBUG_PORT = 9222;
const CHROME_BIN = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** Manages the Playwright browser instance connected to the user's Chrome profile. */
export class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private conversations: Conversation[] = [];
  private bridgeDir: string | null = null;

  /** Launch browser. With chromeRoot, connects to or launches Chrome with the given profile. */
  async launch(chromeRoot?: string, profileDirName?: string): Promise<Page> {
    if (this.context || this.browser) await this.close();

    if (chromeRoot) {
      return this.launchWithProfile(chromeRoot, profileDirName ?? "Default");
    }

    const browser = await chromium.launch({ headless: false });
    this.browser = browser;
    this.context = await browser.newContext();
    this.page = await this.context.newPage();
    this.interceptResponses();
    await this.page.goto("https://chatgpt.com");
    return this.page;
  }

  private async launchWithProfile(chromeRoot: string, profileDir: string): Promise<Page> {
    // Strategy 1: CDP connect to already-running Chrome with debug port
    try {
      this.browser = await chromium.connectOverCDP(`http://localhost:${DEBUG_PORT}`);
      const found = this.findChatGptPageInAllContexts();
      if (found) {
        this.context = found.context;
        this.page = found.page;
        console.log("  Connected to running Chrome, found chatgpt.com tab.");
      } else {
        this.context = this.browser.contexts()[0]!;
        this.page = await this.context.newPage();
        console.log("  Connected to running Chrome, no chatgpt.com tab — opening one.");
      }
      this.interceptResponses();
      await this.navigateIfNeeded();
      return this.page;
    } catch {
      // CDP not available — fall through to launching Chrome ourselves
    }

    // Strategy 2: Kill any running Chrome, clear lock, launch Chrome manually
    // (without Playwright's --enable-automation flag to avoid Cloudflare detection),
    // then connect via CDP.
    if (isChromeRunning()) {
      console.log("  Chrome is running. Quitting to relaunch with automation...");
      forceQuitChrome();
      await waitForChromeExit();
    }

    const lockFile = join(chromeRoot, "SingletonLock");
    if (existsSync(lockFile)) {
      try { unlinkSync(lockFile); } catch { /* best effort */ }
    }

    const bridgeDir = this.createBridgeDir(chromeRoot);

    // Launch Chrome directly — no Playwright automation flags
    const child = spawn(CHROME_BIN, [
      `--user-data-dir=${bridgeDir}`,
      `--profile-directory=${profileDir}`,
      `--remote-debugging-port=${DEBUG_PORT}`,
      "--no-first-run",
      "--no-default-browser-check",
      "https://chatgpt.com",
    ], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();

    // Wait for Chrome to start and open the debug port
    console.log("  Waiting for Chrome debug port...");
    await waitForDebugPort(DEBUG_PORT, 30_000);

    this.browser = await chromium.connectOverCDP(`http://localhost:${DEBUG_PORT}`);
    const found = this.findChatGptPageInAllContexts();
    this.context = found?.context ?? this.browser.contexts()[0]!;
    this.page = found?.page ?? await this.context.newPage();
    this.interceptResponses();
    await this.navigateIfNeeded();
    return this.page;
  }

  /** Create a temp dir with symlinks to the real Chrome profile (bypasses default-dir restriction). */
  private createBridgeDir(chromeRoot: string): string {
    const dir = join(tmpdir(), "chatgpt-bridge-chrome");

    if (existsSync(dir)) {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* stale */ }
    }
    mkdirSync(dir, { recursive: true });

    for (const entry of readdirSync(chromeRoot)) {
      try {
        symlinkSync(join(chromeRoot, entry), join(dir, entry));
      } catch {
        // Some entries (locks, sockets) may fail — that's OK
      }
    }

    this.bridgeDir = dir;
    return dir;
  }

  /** Search all browser contexts for a tab showing chatgpt.com. */
  private findChatGptPageInAllContexts(): { context: BrowserContext; page: Page } | null {
    if (!this.browser) return null;

    for (const ctx of this.browser.contexts()) {
      for (const page of ctx.pages()) {
        if (page.url().includes("chatgpt.com")) {
          return { context: ctx, page };
        }
      }
    }
    return null;
  }

  private async navigateIfNeeded(): Promise<void> {
    if (!this.page!.url().includes("chatgpt.com")) {
      await this.page!.goto("https://chatgpt.com", { waitUntil: "domcontentloaded" });
    }
    // Wait for the page to actually render
    await this.page!.waitForSelector("#prompt-textarea, [contenteditable]", { timeout: 30_000 }).catch(() => {});
  }

  private interceptResponses(): void {
    this.context!.on("response", (response: Response) => {
      this.interceptConversationResponse(response).catch(() => {});
    });
  }

  private async interceptConversationResponse(response: Response): Promise<void> {
    const url = response.url();
    if (!url.includes("/backend-api/conversations?")) return;

    try {
      const body = await response.json();
      const items = body?.items;
      if (!Array.isArray(items)) return;

      this.conversations = items.map((item: Record<string, unknown>) => ({
        id: String(item.id),
        title: String(item.title ?? "Untitled"),
        url: `https://chatgpt.com/c/${item.id}`,
      }));
    } catch {
      // Not JSON or unexpected structure — skip
    }
  }

  getConversations(): Conversation[] {
    return this.conversations;
  }

  findConversation(idPrefix: string): Conversation | undefined {
    return this.conversations.find((c) => c.id.startsWith(idPrefix));
  }

  getPage(): Page {
    if (!this.page) throw new Error("Browser not launched. Call launch() first.");
    return this.page;
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.page = null;
    this.context = null;
    this.browser = null;

    if (this.bridgeDir && existsSync(this.bridgeDir)) {
      try { rmSync(this.bridgeDir, { recursive: true, force: true }); } catch {}
      this.bridgeDir = null;
    }
  }
}

function isChromeRunning(): boolean {
  try {
    const out = execFileSync("pgrep", ["-x", "Google Chrome"], {
      encoding: "utf-8",
      timeout: 2_000,
    });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

function forceQuitChrome(): void {
  try {
    execFileSync("osascript", ["-e", 'tell application "Google Chrome" to quit'], { timeout: 8_000 });
  } catch { /* Chrome may not respond */ }
  try {
    execFileSync("pkill", ["-x", "Google Chrome"], { timeout: 5_000 });
  } catch { /* already exited */ }
  try {
    execFileSync("pkill", ["-9", "-x", "Google Chrome"], { timeout: 3_000 });
  } catch { /* already gone */ }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForChromeExit(maxWaitMs = 15_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (!isChromeRunning()) return;
    await sleep(500);
  }
  throw new Error("Timed out waiting for Chrome to exit");
}

async function waitForDebugPort(port: number, maxWaitMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const resp = await fetch(`http://localhost:${port}/json/version`);
      if (resp.ok) return;
    } catch {
      // Not ready yet
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for Chrome debug port ${port}`);
}
