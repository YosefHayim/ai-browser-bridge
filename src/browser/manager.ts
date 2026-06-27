import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page, type Response } from "playwright";
import { bridgeDir, chromeProfileDir } from "../core/paths.ts";
import type { Conversation } from "../types/types.ts";

/** Chrome remote-debugging port the bridge attaches to / spawns on. */
export const BRIDGE_DEBUG_PORT = 9222;
const CHROME_BIN = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** Manages the Playwright browser instance connected to the bridge's isolated Chrome profile. */
export class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private conversations: Conversation[] = [];

  /** @param repoPath Target repo whose `.bridge/chrome-profile` holds the signed-in session. */
  constructor(private readonly repoPath: string = process.cwd()) {}

  /**
   * Launch the browser using the bridge's isolated Chrome profile.
   *
   * First tries to CDP-attach to an already-running Chrome on port 9222
   * (fast path for repeated restarts).  If that fails, spawns a fresh
   * Chrome process with --user-data-dir pointing at BRIDGE_PROFILE_DIR
   * and waits for the debug port before connecting.
   */
  async launch(): Promise<Page> {
    if (this.context || this.browser) await this.close();

    // Self-ignore `.bridge/` before writing the login cookies, so the profile can
    // never enter the repo even when launched outside the engine (e.g. `bridge login`).
    mkdirSync(bridgeDir(this.repoPath), { recursive: true });
    writeFileSync(join(bridgeDir(this.repoPath), ".gitignore"), "*\n");
    mkdirSync(chromeProfileDir(this.repoPath), { recursive: true });

    // Fast path: reuse a Chrome instance already listening on the debug port
    try {
      this.browser = await chromium.connectOverCDP(`http://localhost:${BRIDGE_DEBUG_PORT}`);
      const found = this.findChatGptPageInAllContexts();
      if (found) {
        this.context = found.context;
        this.page = found.page;
        console.error("  Connected to running Chrome, found chatgpt.com tab.");
      } else {
        this.context = this.browser.contexts()[0]!;
        this.page = await this.context.newPage();
        console.error("  Connected to running Chrome, no chatgpt.com tab — opening one.");
      }
      this.interceptResponses();
      await this.navigateIfNeeded();
      return this.page;
    } catch {
      // CDP not available — fall through to spawning Chrome
    }

    // Slow path: spawn Chrome with the bridge profile and wait for the debug port
    const child = spawn(CHROME_BIN, [
      `--user-data-dir=${chromeProfileDir(this.repoPath)}`,
      `--remote-debugging-port=${BRIDGE_DEBUG_PORT}`,
      "--no-first-run",
      "--no-default-browser-check",
      "https://chatgpt.com",
    ], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();

    console.error("  Waiting for Chrome debug port...");
    await waitForDebugPort(BRIDGE_DEBUG_PORT, 30_000);

    this.browser = await chromium.connectOverCDP(`http://localhost:${BRIDGE_DEBUG_PORT}`);
    const found = this.findChatGptPageInAllContexts();
    this.context = found?.context ?? this.browser.contexts()[0]!;
    this.page = found?.page ?? await this.context.newPage();
    this.interceptResponses();
    await this.navigateIfNeeded();
    return this.page;
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
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
