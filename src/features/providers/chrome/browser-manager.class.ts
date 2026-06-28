import { execFile, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser, BrowserContext, Page, Response } from "playwright";
import { chromium } from "playwright";
import type { Conversation } from "../../domain/types.ts";
import { bridgeDir, chromeProfileDir } from "../../store/paths.ts";
import type { BrowserProvider } from "../browser-provider.types.ts";
import { getBrowserProvider, type BridgeProviderId } from "../create-provider.factory.ts";

/** Chrome remote-debugging port the bridge attaches to / spawns on. */
export const BRIDGE_DEBUG_PORT = 9222;

const CHROME_BIN = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CDP_URL = `http://127.0.0.1:${BRIDGE_DEBUG_PORT}`;

/** Raised when Chrome is open but not reachable on the debug port. */
export class BrowserAttachError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserAttachError";
  }
}

/** Whether localhost responds on the Chrome remote debugging port. */
export async function isDebugPortListening(input: { port?: number } | number = {}): Promise<boolean> {
  const port = typeof input === "number" ? input : input.port ?? BRIDGE_DEBUG_PORT;
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/json/version`);
    return resp.ok;
  } catch {
    return false;
  }
}

/** Whether a Google Chrome process is running on macOS. */
export function isChromeProcessRunning(_input: { unused?: true } = {}): Promise<boolean> {
  return new Promise((done) => {
    execFile("pgrep", ["-x", "Google Chrome"], (...execArgs) => {
      const err = execArgs[0] as NodeJS.ErrnoException | null;
      const stdout = execArgs[1] as string;
      done(!err && stdout.trim().length > 0);
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDebugPort(port: number, maxWaitMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (await isDebugPortListening({ port })) return;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for Chrome debug port ${port}`);
}

function prepareProfileDirectories(repoPath: string, profileDir: string): void {
  mkdirSync(bridgeDir(repoPath), { recursive: true });
  writeFileSync(join(bridgeDir(repoPath), ".gitignore"), "*\n");
  mkdirSync(profileDir, { recursive: true });
}

function spawnChrome(profileDir: string, defaultUrl: string): void {
  const child = spawn(CHROME_BIN, [
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${BRIDGE_DEBUG_PORT}`,
    "--no-first-run",
    "--no-default-browser-check",
    defaultUrl,
  ], { detached: true, stdio: "ignore" });
  child.unref();
}

function attachOnlyError(): BrowserAttachError {
  return new BrowserAttachError(
    `No Chrome listening on debug port ${BRIDGE_DEBUG_PORT}. Launch Chrome with --remote-debugging-port=9222 or run \`bridge login\`.`,
  );
}

function chromeAlreadyRunningError(): BrowserAttachError {
  return new BrowserAttachError(
    "Chrome is already running without the bridge debug port. The bridge will not open a second window.",
  );
}

function spawnReadyError(): BrowserAttachError {
  return new BrowserAttachError(`Chrome started but debug port ${BRIDGE_DEBUG_PORT} did not become ready.`);
}

interface CdpConnectState {
  browser: Browser | null;
  context: BrowserContext | null;
  page: Page | null;
}

function findProviderPage(browser: Browser, provider: BrowserProvider): { context: BrowserContext; page: Page } | null {
  for (const ctx of browser.contexts()) {
    for (const page of ctx.pages()) {
      if (page.url().includes(provider.origin)) return { context: ctx, page };
    }
  }
  return null;
}

async function navigateIfNeeded(page: Page, provider: BrowserProvider): Promise<void> {
  if (!page.url().includes(provider.origin)) {
    await page.goto(provider.defaultUrl, { waitUntil: "domcontentloaded" });
  }
  await page.waitForSelector(provider.composerSelector, { timeout: 30_000 }).catch(() => {});
}

function interceptResponses(context: BrowserContext, providerId: string, conversations: Conversation[]): void {
  context.on("response", (response: Response) => {
    if (providerId !== "chatgpt") return;
    void parseChatGptConversations(response, conversations).catch(() => {});
  });
}

async function parseChatGptConversations(response: Response, conversations: Conversation[]): Promise<void> {
  const url = response.url();
  if (!url.includes("/backend-api/conversations?")) return;
  const body = await response.json().catch(() => null);
  const items = body?.items;
  if (!Array.isArray(items)) return;
  conversations.splice(0, conversations.length, ...items.map((item: Record<string, unknown>) => ({
    id: String(item.id),
    title: String(item.title ?? "Untitled"),
    url: `https://chatgpt.com/c/${item.id}`,
  })));
}

async function tryConnectOverCdp(input: {
  state: CdpConnectState;
  provider: BrowserProvider;
  attempts?: number;
  intervalMs?: number;
  isPortListening: () => Promise<boolean>;
  close: () => Promise<void>;
}): Promise<boolean> {
  const attempts = input.attempts ?? 8;
  const intervalMs = input.intervalMs ?? 400;
  for (let i = 0; i < attempts; i++) {
    if (!(await input.isPortListening())) {
      if (i < attempts - 1) await sleep(intervalMs);
      continue;
    }
    if (await connectOnceOverCdp(input)) return true;
    if (i < attempts - 1) await sleep(intervalMs);
  }
  return false;
}

async function connectOnceOverCdp(input: {
  state: CdpConnectState;
  provider: BrowserProvider;
  close: () => Promise<void>;
}): Promise<boolean> {
  try {
    input.state.browser = await chromium.connectOverCDP(CDP_URL);
    const found = findProviderPage(input.state.browser, input.provider);
    if (found) {
      input.state.context = found.context;
      input.state.page = found.page;
      console.error(`  Connected to running Chrome, found ${input.provider.origin} tab.`);
    } else {
      input.state.context = input.state.browser.contexts()[0]!;
      input.state.page = await input.state.context.newPage();
      console.error(`  Connected to running Chrome, no ${input.provider.origin} tab — opening one.`);
    }
    return Boolean(input.state.page);
  } catch {
    await input.close();
    return false;
  }
}

/** Manages the Playwright browser connected to the bridge Chrome profile. */
export class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private conversations: Conversation[] = [];
  private readonly providerId: BridgeProviderId;
  private readonly provider: BrowserProvider;
  readonly attachedViaCdp = { value: false };
  readonly spawnedNew = { value: false };

  constructor(private readonly repoPath: string = process.cwd(), providerId: BridgeProviderId = "chatgpt") {
    this.providerId = providerId;
    this.provider = getBrowserProvider(providerId);
  }

  /** Launch Chrome or attach to an existing debug session. */
  async launch(): Promise<Page> {
    await this.resetSession();
    prepareProfileDirectories(this.repoPath, this.profileDir());
    if (await this.connectExisting()) return this.markAttached();
    return await this.continueLaunch();
  }

  /** Attach to an already-running Chrome debug session without spawning a new window. */
  async attach(opts?: { attempts?: number; intervalMs?: number }): Promise<Page> {
    await this.resetSession();
    prepareProfileDirectories(this.repoPath, this.profileDir());
    if (await this.connectExisting(opts)) return this.markAttached();
    throw attachOnlyError();
  }

  /** Return the active Playwright page, or throw if the browser is not launched. */
  getPage(): Page {
    if (!this.page) throw new Error("Browser not launched. Call launch() first.");
    return this.page;
  }

  /** Close the browser session and reset internal state. */
  async close(): Promise<void> {
    await this.browser?.close();
    this.page = null;
    this.context = null;
    this.browser = null;
  }

  /** Clear any active session before a new launch or attach. */
  private async resetSession(): Promise<void> {
    if (this.context || this.browser) await this.close();
  }

  /** Mark the session as attached via CDP and return the active page. */
  private markAttached(): Page {
    this.attachedViaCdp.value = true;
    return this.getPage();
  }

  /** Resolve the isolated Chrome profile directory for this repo and provider. */
  private profileDir(): string {
    return chromeProfileDir(this.repoPath, this.providerId);
  }

  /** Spawn Chrome or attach when the debug port is already open. */
  private async continueLaunch(): Promise<Page> {
    if (await isDebugPortListening({ port: BRIDGE_DEBUG_PORT })) {
      const connected = await this.connectExisting({ attempts: 20, intervalMs: 500 });
      if (connected) return this.getPage();
      throw new BrowserAttachError(
        `Chrome debug port ${BRIDGE_DEBUG_PORT} is open but the bridge could not attach. Close other Chrome windows or run \`bridge login\`.`,
      );
    }
    if (await isChromeProcessRunning()) throw chromeAlreadyRunningError();
    return await this.runSpawnAndConnect();
  }

  /** Spawn Chrome and wait for a CDP connection. */
  private async runSpawnAndConnect(): Promise<Page> {
    spawnChrome(this.profileDir(), this.provider.defaultUrl);
    this.spawnedNew.value = true;
    console.error("  Waiting for Chrome debug port...");
    await waitForDebugPort(BRIDGE_DEBUG_PORT);
    const connected = await this.connectExisting({ attempts: 20, intervalMs: 500 });
    if (!connected || !this.page) throw spawnReadyError();
    return this.getPage();
  }

  /** Build mutable CDP state for connect helpers. */
  private cdpState(): CdpConnectState {
    return { browser: this.browser, context: this.context, page: this.page };
  }

  /** Apply CDP connection results to instance fields. */
  private applyCdpState(state: CdpConnectState): void {
    this.browser = state.browser;
    this.context = state.context;
    this.page = state.page;
  }

  /** Retry CDP attach until a provider page is available. */
  private async connectExisting(opts?: { attempts?: number; intervalMs?: number }): Promise<boolean> {
    const state = this.cdpState();
    const connected = await tryConnectOverCdp({
      state,
      provider: this.provider,
      attempts: opts?.attempts,
      intervalMs: opts?.intervalMs,
      isPortListening: () => isDebugPortListening(),
      close: () => this.close(),
    });
    if (!connected) return false;
    this.finalizeCdpConnection(state);
    return true;
  }

  /** Wire response listeners and navigate after a successful CDP attach. */
  private finalizeCdpConnection(state: CdpConnectState): void {
    this.applyCdpState(state);
    interceptResponses(this.context!, this.providerId, this.conversations);
    void navigateIfNeeded(this.page!, this.provider);
  }
}
