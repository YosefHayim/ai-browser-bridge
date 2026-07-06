import { execFile, spawn } from "node:child_process";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { Conversation } from "@/features/domain";
import {
  type BridgeProviderId,
  type BrowserProvider,
  getBrowserProvider,
} from "@/features/providers";
import { bridgeDir } from "@/features/store";
import type { Browser, BrowserContext, Page, Response } from "playwright";
import { chromium } from "playwright";
import { bridgeChromeProfileRoot, chromeAppName } from "./browserProfile.ts";

/** Chrome remote-debugging port the bridge attaches to / spawns on. */
export const BRIDGE_DEBUG_PORT = 9222;

const CDP_URL = `http://127.0.0.1:${BRIDGE_DEBUG_PORT}`;
const execFileAsync = promisify(execFile);

/**
 * Parse `--user-data-dir=` from the Chrome process bound to a debug port.
 *
 * @param port - Port value.
 * @returns The `getUserDataDirOnDebugPort` result.
 * @example
 * ```ts
 * const result = await getUserDataDirOnDebugPort(port);
 * ```
 */
export const getUserDataDirOnDebugPort = async (
  port: number = BRIDGE_DEBUG_PORT,
): Promise<string | null> => {
  try {
    const { stdout } = await execFileAsync("ps", ["ax", "-o", "command="]);
    const needle = `--remote-debugging-port=${port}`;
    for (const line of stdout.split("\n")) {
      if (!line.includes(needle)) continue;
      // Matches a Chrome command line arg like --user-data-dir=/Users/me/Profile.
      // Capture group 1 is the profile directory value after --user-data-dir=.
      const match = line.match(/--user-data-dir=([^\s]+)/);
      if (match?.[1]) return match[1];
    }
    return null;
  } catch {
    return null;
  }
};

/**
 * Whether two profile directories refer to the same path.
 *
 * @param expected - Expected value.
 * @param actual - Actual value.
 * @returns The `profilesMatch` result.
 * @example
 * ```ts
 * const result = profilesMatch(expected, actual);
 * ```
 */
export const profilesMatch = (expected: string, actual: string): boolean => {
  const normalize = (value: string): string => {
    try {
      return realpathSync(resolve(value));
    } catch {
      return resolve(value);
    }
  };
  return normalize(expected) === normalize(actual);
};

const waitForDebugPortClosed = async (port: number, maxWaitMs = 10_000): Promise<void> => {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (!(await isDebugPortListening({ port }))) return;
    await sleep(250);
  }
};

/**
 * Stop Chrome processes listening on the debug port (wrong profile recovery).
 *
 * @param port - Port value.
 * @returns Completes when `terminateChromeOnDebugPort` finishes.
 * @example
 * ```ts
 * await terminateChromeOnDebugPort(port);
 * ```
 */
export const terminateChromeOnDebugPort = async (
  port: number = BRIDGE_DEBUG_PORT,
): Promise<void> => {
  try {
    await execFileAsync("pkill", ["-f", `--remote-debugging-port=${port}`]);
  } catch {
    /* no matching process */
  }
  await waitForDebugPortClosed(port);
};

/** Raised when Chrome is open but not reachable on the debug port. */
export class BrowserAttachError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserAttachError";
  }
}

/**
 * Whether localhost responds on the Chrome remote debugging port.
 *
 * @param input - Input values for the operation.
 * @returns Whether the condition matches.
 * @example
 * ```ts
 * const result = await isDebugPortListening(input);
 * ```
 */
export const isDebugPortListening = async (
  input: { port?: number } | number = {},
): Promise<boolean> => {
  const port = typeof input === "number" ? input : (input.port ?? BRIDGE_DEBUG_PORT);
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/json/version`);
    return resp.ok;
  } catch {
    return false;
  }
};

/**
 * Whether the configured Chrome app process is running on macOS.
 *
 * @param input - Optional app name override for process matching.
 * @returns Whether the condition matches.
 * @example
 * ```ts
 * const result = await isChromeProcessRunning({ appName: "Google Chrome for Testing" });
 * ```
 */
export const isChromeProcessRunning = (input: { appName?: string } = {}): Promise<boolean> => {
  const appName = input.appName ?? chromeAppName();
  return new Promise((done) => {
    execFile("pgrep", ["-f", `${appName}.app/Contents/MacOS`], (...execArgs) => {
      const err = execArgs[0] as NodeJS.ErrnoException | null;
      const stdout = execArgs[1] as string;
      done(!err && stdout.trim().length > 0);
    });
  });
};

const sleep = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

const waitForDebugPort = async (port: number, maxWaitMs = 30_000): Promise<void> => {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (await isDebugPortListening({ port })) return;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for Chrome debug port ${port}`);
};

const prepareBridgeDirectory = (repoPath: string): void => {
  mkdirSync(bridgeDir(repoPath), { recursive: true });
  writeFileSync(join(bridgeDir(repoPath), ".gitignore"), "*\n");
};

/**
 * Chrome argv for the shared bridge debug profile.
 *
 * @param defaultUrl - Default url value.
 * @param profileRoot - Profile root value.
 * @returns The `buildChromeLaunchArgs` result.
 * @example
 * ```ts
 * const result = buildChromeLaunchArgs(defaultUrl, profileRoot);
 * ```
 */
export const buildChromeLaunchArgs = (
  defaultUrl: string,
  profileRoot: string = bridgeChromeProfileRoot(),
): string[] => {
  return [
    `--remote-debugging-port=${BRIDGE_DEBUG_PORT}`,
    `--user-data-dir=${profileRoot}`,
    "--no-first-run",
    "--no-default-browser-check",
    defaultUrl,
  ];
};

const spawnChrome = (defaultUrl: string): void => {
  const profileRoot = bridgeChromeProfileRoot();
  mkdirSync(profileRoot, { recursive: true });
  const child = spawn(
    "open",
    ["-na", chromeAppName(), "--args", ...buildChromeLaunchArgs(defaultUrl, profileRoot)],
    {
      detached: true,
      stdio: "ignore",
    },
  );
  child.unref();
};

const attachOnlyError = (): BrowserAttachError => {
  return new BrowserAttachError(
    `No Chrome listening on debug port ${BRIDGE_DEBUG_PORT}. Run \`bridge chrome start\` before using browser automation.`,
  );
};

const spawnReadyError = (): BrowserAttachError => {
  return new BrowserAttachError(
    `Chrome started but debug port ${BRIDGE_DEBUG_PORT} did not become ready.`,
  );
};

interface CdpConnectState {
  browser: Browser | null;
  context: BrowserContext | null;
  page: Page | null;
}

const findProviderPage = (
  browser: Browser,
  provider: BrowserProvider,
): { context: BrowserContext; page: Page } | null => {
  for (const ctx of browser.contexts()) {
    for (const page of ctx.pages()) {
      if (page.url().includes(provider.origin)) return { context: ctx, page };
    }
  }
  return null;
};

const navigateIfNeeded = async (page: Page, provider: BrowserProvider): Promise<void> => {
  wireSafeDialogHandlers(page);
  if (!page.url().includes(provider.origin)) {
    await page.goto(provider.defaultUrl, { waitUntil: "domcontentloaded" });
  }
  await page.waitForSelector(provider.composerSelector, { timeout: 30_000 }).catch(() => {});
};

/** Dismiss JS alerts/confirms without crashing when CDP races Playwright's dialog manager. */
const wireSafeDialogHandlers = (page: Page): void => {
  if ((page as Page & { __bridgeDialogWired?: boolean }).__bridgeDialogWired) return;
  (page as Page & { __bridgeDialogWired?: boolean }).__bridgeDialogWired = true;
  page.on("dialog", (dialog) => {
    void dialog.dismiss().catch(() => undefined);
  });
};

const wireSafeDialogHandlersForContext = (context: BrowserContext): void => {
  for (const page of context.pages()) wireSafeDialogHandlers(page);
  context.on("page", (page) => wireSafeDialogHandlers(page));
};

const interceptResponses = (
  context: BrowserContext,
  providerId: string,
  conversations: Conversation[],
): void => {
  context.on("response", (response: Response) => {
    if (providerId !== "chatgpt") return;
    void parseChatGptConversations(response, conversations).catch(() => {});
  });
};

const parseChatGptConversations = async (
  response: Response,
  conversations: Conversation[],
): Promise<void> => {
  const url = response.url();
  if (!url.includes("/backend-api/conversations?")) return;
  const body = await response.json().catch(() => null);
  const items = body?.items;
  if (!Array.isArray(items)) return;
  conversations.splice(
    0,
    conversations.length,
    ...items.map((item: Record<string, unknown>) => ({
      id: String(item.id),
      title: String(item.title ?? "Untitled"),
      url: `https://chatgpt.com/c/${item.id}`,
    })),
  );
};

const tryConnectOverCdp = async (input: {
  state: CdpConnectState;
  provider: BrowserProvider;
  attempts?: number;
  intervalMs?: number;
  isPortListening: () => Promise<boolean>;
  close: () => Promise<void>;
}): Promise<boolean> => {
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
};

const connectOnceOverCdp = async (input: {
  state: CdpConnectState;
  provider: BrowserProvider;
  close: () => Promise<void>;
}): Promise<boolean> => {
  try {
    input.state.browser = await chromium.connectOverCDP(CDP_URL);
    const found = findProviderPage(input.state.browser, input.provider);
    if (found) {
      input.state.context = found.context;
      input.state.page = found.page;
      console.error(`  Connected to running Chrome, found ${input.provider.origin} tab.`);
    } else {
      const [firstContext] = input.state.browser.contexts();
      if (!firstContext) {
        await input.close();
        return false;
      }
      input.state.context = firstContext;
      input.state.page = await firstContext.newPage();
      console.error(
        `  Connected to running Chrome, no ${input.provider.origin} tab — opening one.`,
      );
    }
    return Boolean(input.state.page);
  } catch {
    await input.close();
    return false;
  }
};

/** Manages the Playwright browser connected to Chrome's debug port. */
export class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private conversations: Conversation[] = [];
  private readonly providerId: BridgeProviderId;
  private readonly provider: BrowserProvider;
  readonly attachedViaCdp = { value: false };
  readonly spawnedNew = { value: false };

  constructor(
    private readonly repoPath: string = process.cwd(),
    providerId: BridgeProviderId = "chatgpt",
  ) {
    this.providerId = providerId;
    this.provider = getBrowserProvider(providerId);
  }

  /**
   * Launch Chrome or attach to an existing debug session.
   *
   * @returns The `launch` result.
   * @example
   * ```ts
   * const result = await browserManager.launch();
   * ```
   */
  async launch(): Promise<Page> {
    await this.resetSession();
    prepareBridgeDirectory(this.repoPath);
    if (await this.connectExisting()) return this.markAttached();
    return await this.continueLaunch();
  }

  /**
   * Attach to an already-running Chrome debug session without spawning a new window.
   *
   * @param opts - Opts value.
   * @returns The `attach` result.
   * @example
   * ```ts
   * const result = await browserManager.attach(opts);
   * ```
   */
  async attach(opts?: { attempts?: number; intervalMs?: number }): Promise<Page> {
    await this.resetSession();
    prepareBridgeDirectory(this.repoPath);
    if (await this.connectExisting(opts)) return this.markAttached();
    throw attachOnlyError();
  }

  /**
   * Return the active Playwright page, or throw if the browser is not launched.
   *
   * @returns The `getPage` result.
   * @example
   * ```ts
   * const result = browserManager.getPage();
   * ```
   */
  getPage(): Page {
    if (!this.page) throw new Error("Browser not launched. Call launch() first.");
    return this.page;
  }

  /**
   * Close the browser session and reset internal state.
   *
   * @returns Completes when `close` finishes.
   * @example
   * ```ts
   * await browserManager.close();
   * ```
   */
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

  /** Spawn Chrome or attach when the debug port is already open. */
  private async continueLaunch(): Promise<Page> {
    if (await isDebugPortListening({ port: BRIDGE_DEBUG_PORT })) {
      const connected = await this.connectExisting({ attempts: 20, intervalMs: 500 });
      if (connected) return this.getPage();
      throw new BrowserAttachError(
        `Chrome debug port ${BRIDGE_DEBUG_PORT} is open but the bridge could not attach. Run \`bridge status\` to inspect the Chrome owner.`,
      );
    }
    return await this.runSpawnAndConnect();
  }

  /** Spawn Chrome and wait for a CDP connection. */
  private async runSpawnAndConnect(): Promise<Page> {
    console.error("  Launching Chrome with bridge debug port using the shared bridge profile.");
    spawnChrome(this.provider.defaultUrl);
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
  private async connectExisting(opts?: {
    attempts?: number;
    intervalMs?: number;
  }): Promise<boolean> {
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
    const { context, page } = state;
    if (!context || !page) return;
    wireSafeDialogHandlersForContext(context);
    interceptResponses(context, this.providerId, this.conversations);
    void navigateIfNeeded(page, this.provider);
  }
}
