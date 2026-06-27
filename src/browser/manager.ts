import { execFile, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page, type Response } from "playwright";
import { bridgeDir, chromeProfileDir } from "../core/paths.ts";
import type { Conversation } from "../types/types.ts";

/** Chrome remote-debugging port the bridge attaches to / spawns on. */
export const BRIDGE_DEBUG_PORT = 9222;
const CHROME_BIN = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CDP_URL = `http://localhost:${BRIDGE_DEBUG_PORT}`;

/** Raised when Chrome is open but not reachable on the debug port (avoids spawning a guest window). */
export class BrowserAttachError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserAttachError";
  }
}

export interface LaunchOptions {
  /** When true, never spawn a new Chrome — attach to an existing debug listener only. */
  attachOnly?: boolean;
}

/** Manages the Playwright browser instance connected to the bridge's isolated Chrome profile. */
export class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private conversations: Conversation[] = [];
  /** True when this run connected to an already-running Chrome on the debug port. */
  readonly attachedViaCdp = { value: false };
  /** True when this run spawned a new Chrome with the bridge profile. */
  readonly spawnedNew = { value: false };

  /** @param repoPath Target repo whose `.bridge/chrome-profile` holds the signed-in session. */
  constructor(private readonly repoPath: string = process.cwd()) {}

  /**
   * Launch the browser using the bridge's isolated Chrome profile.
   *
   * First tries to CDP-attach to an already-running Chrome on port 9222
   * (fast path for repeated restarts).  If that fails, spawns a fresh
   * Chrome process with --user-data-dir pointing at BRIDGE_PROFILE_DIR
   * and waits for the debug port before connecting — but only when no
   * other Chrome process is already running (spawning while the user's
   * daily Chrome is open creates a second, logged-out guest window).
   */
  async launch(options: LaunchOptions = {}): Promise<Page> {
    if (this.context || this.browser) await this.close();

    // Self-ignore `.bridge/` before writing the login cookies, so the profile can
    // never enter the repo even when launched outside the engine (e.g. `bridge login`).
    mkdirSync(bridgeDir(this.repoPath), { recursive: true });
    writeFileSync(join(bridgeDir(this.repoPath), ".gitignore"), "*\n");
    mkdirSync(chromeProfileDir(this.repoPath), { recursive: true });

    const connected = await this.tryConnectOverCdp();
    if (connected) {
      this.attachedViaCdp.value = true;
      return this.page!;
    }

    if (options.attachOnly) {
      throw new BrowserAttachError(
        `No Chrome listening on debug port ${BRIDGE_DEBUG_PORT}. ` +
          "Launch Chrome with --remote-debugging-port=9222 or run `bridge login`.",
      );
    }

    if (await isChromeProcessRunning()) {
      throw new BrowserAttachError(
        "Chrome is already running without the bridge debug port. " +
          "The bridge will not open a second (logged-out) window.\n" +
          "Fix: quit Chrome (Cmd+Q), relaunch with debug port 9222 and your profile, " +
          "then run bridge again — or run `bridge stop` and `bridge login` for the isolated profile.",
      );
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
    this.spawnedNew.value = true;

    console.error("  Waiting for Chrome debug port...");
    await waitForDebugPort(BRIDGE_DEBUG_PORT, 30_000);

    const spawned = await this.tryConnectOverCdp({ attempts: 20, intervalMs: 500 });
    if (!spawned || !this.page) {
      throw new BrowserAttachError(`Chrome started but debug port ${BRIDGE_DEBUG_PORT} did not become ready.`);
    }
    return this.page;
  }

  /** Retry CDP attach so a warm Chrome has time to expose the debug port. */
  private async tryConnectOverCdp(opts?: { attempts?: number; intervalMs?: number }): Promise<boolean> {
    const attempts = opts?.attempts ?? 8;
    const intervalMs = opts?.intervalMs ?? 400;

    for (let i = 0; i < attempts; i++) {
      if (!(await isDebugPortListening())) {
        if (i < attempts - 1) await sleep(intervalMs);
        continue;
      }

      try {
        this.browser = await chromium.connectOverCDP(CDP_URL);
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
        return true;
      } catch {
        await this.close();
        if (i < attempts - 1) await sleep(intervalMs);
      }
    }
    return false;
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

/** Whether localhost:9222 responds (Chrome remote debugging is up). */
export async function isDebugPortListening(port = BRIDGE_DEBUG_PORT): Promise<boolean> {
  try {
    const resp = await fetch(`http://localhost:${port}/json/version`);
    return resp.ok;
  } catch {
    return false;
  }
}

/** Whether a Google Chrome process is running (macOS). */
export function isChromeProcessRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("pgrep", ["-x", "Google Chrome"], (err, stdout) => {
      resolve(!err && stdout.trim().length > 0);
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDebugPort(port: number, maxWaitMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (await isDebugPortListening(port)) return;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for Chrome debug port ${port}`);
}
