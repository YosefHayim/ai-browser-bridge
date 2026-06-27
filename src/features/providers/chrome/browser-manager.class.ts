import type { Browser, Page } from "playwright";
import type { Conversation } from "../../domain/types.ts";
import type { BrowserProvider } from "../browser-provider.types.ts";
import { getBrowserProvider, type BridgeProviderId } from "../create-provider.factory.ts";
import { chromeProfileDir } from "../../store/paths.ts";
import { interceptResponses, navigateIfNeeded, tryConnectOverCdp, type CdpConnectState } from "./browser-cdp.helpers.ts";
import { isDebugPortListening } from "./chrome-debug.ts";
import { runBrowserLaunch, type BrowserLaunchContext } from "./browser-manager.launch.ts";

/** Options for launching or attaching to Chrome. */
export interface LaunchOptions { attachOnly?: boolean; }

/** Manages the Playwright browser connected to the bridge Chrome profile. */
export class BrowserManager {
  private browser: Browser | null = null;
  private context: import("playwright").BrowserContext | null = null;
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

  async launch(options: LaunchOptions = {}): Promise<Page> {
    return await runBrowserLaunch(this.launchContext(), options.attachOnly);
  }

  getConversations(): Conversation[] { return this.conversations; }
  findConversation(idPrefix: string): Conversation | undefined {
    return this.conversations.find((conversation) => conversation.id.startsWith(idPrefix));
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

  private launchContext(): BrowserLaunchContext {
    return {
      repoPath: this.repoPath,
      providerId: this.providerId,
      provider: this.provider,
      attachedViaCdp: this.attachedViaCdp,
      spawnedNew: this.spawnedNew,
      hasActiveSession: () => Boolean(this.context || this.browser),
      close: () => this.close(),
      connectExisting: (opts) => this.connectExisting(opts),
      getPage: () => this.getPage(),
      hasPage: () => Boolean(this.page),
    };
  }

  private cdpState(): CdpConnectState {
    return { browser: this.browser, context: this.context, page: this.page };
  }

  private applyCdpState(state: CdpConnectState): void {
    this.browser = state.browser;
    this.context = state.context;
    this.page = state.page;
  }

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

  private finalizeCdpConnection(state: CdpConnectState): void {
    this.applyCdpState(state);
    interceptResponses({ context: this.context!, providerId: this.providerId, conversations: this.conversations });
    void navigateIfNeeded({ page: this.page!, provider: this.provider });
  }
}
