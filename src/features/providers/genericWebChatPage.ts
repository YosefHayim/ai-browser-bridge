import type { Page } from "playwright";
import type { ModelOption } from "../domain/types.ts";
import type { BrowserProvider, ResponseWaitOptions } from "./browserProviderTypes.ts";

/** Selectors + metadata describing a plain web-chat UI (composer + streamed reply). */
export interface WebChatProfile {
  id: string;
  origin: string;
  defaultUrl: string;
  defaultModel: string;
  displayName: string;
  /** Composer input (contenteditable or textarea). */
  composerSelector: string;
  /** Container for a single assistant message; the last match is the latest reply. */
  assistantSelector: string;
  /** Container for a single user message (optional; enables full transcript capture). */
  userSelector?: string;
  /** Stop-generating button (optional). */
  stopSelector?: string;
  /** Element whose presence means "not signed in" (optional). */
  signedOutSelector?: string;
  supportsMcpConnector?: boolean;
}

const MODEL_KEYWORDS = ["gpt", "claude", "gemini", "grok", "deepseek", "sonar", "opus", "sonnet"];

/**
 * Best-effort generic adapter for a plain web-chat provider (composer + streamed
 * assistant replies), driven entirely by a {@link WebChatProfile} selector set.
 *
 * LIVE-VERIFY: the selectors each provider passes are a starting point and must be
 * checked against the real, signed-in DOM. Sidebar history, model switching, and
 * prompt rewind are stubbed where a provider exposes no stable generic affordance.
 */
export class GenericWebChatPage implements BrowserProvider {
  readonly id: string;
  readonly origin: string;
  readonly defaultUrl: string;
  readonly defaultModel: string;
  readonly displayName: string;
  readonly composerSelector: string;
  readonly supportsMcpConnector: boolean;
  private readonly profile: WebChatProfile;

  constructor(profile: WebChatProfile) {
    this.profile = profile;
    this.id = profile.id;
    this.origin = profile.origin;
    this.defaultUrl = profile.defaultUrl;
    this.defaultModel = profile.defaultModel;
    this.displayName = profile.displayName;
    this.composerSelector = profile.composerSelector;
    this.supportsMcpConnector = profile.supportsMcpConnector ?? false;
  }

  /** Throw when the composer is absent or a signed-out marker is present. */
  async assertSignedIn(page: Page): Promise<void> {
    if (this.profile.signedOutSelector) {
      const signedOut = await page
        .locator(this.profile.signedOutSelector)
        .count()
        .catch(() => 0);
      if (signedOut > 0) {
        throw new Error(
          `${this.displayName}: not signed in. Run \`bridge login --provider ${this.id}\` once.`,
        );
      }
    }
    const composer = await page
      .locator(this.composerSelector)
      .count()
      .catch(() => 0);
    if (composer === 0) {
      throw new Error(
        `${this.displayName}: composer not found — the page UI may have changed, or you are not signed in.`,
      );
    }
  }

  /** Type the prompt into the composer (contenteditable or textarea). */
  async injectPrompt(page: Page, text: string): Promise<void> {
    const composer = page.locator(this.composerSelector).first();
    await composer.click();
    await composer.fill(text).catch(() => composer.type(text));
  }

  /** Wait for a new assistant message to appear, then for its text to stop growing. */
  async waitForResponse(page: Page, options?: number | ResponseWaitOptions): Promise<void> {
    const opts = typeof options === "number" ? { timeout: options } : (options ?? {});
    const timeout = opts.timeout ?? 300_000;
    const before = opts.previousAssistantCount ?? 0;
    await page
      .waitForFunction(
        (args) => document.querySelectorAll(args.sel).length > args.prev,
        { sel: this.profile.assistantSelector, prev: before },
        { timeout },
      )
      .catch(() => undefined);
    await this.waitForStreamIdle(page, Math.min(timeout, 30_000));
  }

  /** Poll the last assistant message until its text is stable across two reads. */
  private async waitForStreamIdle(page: Page, budgetMs: number): Promise<void> {
    const deadline = Date.now() + budgetMs;
    let previous = "";
    while (Date.now() < deadline) {
      const current = await this.captureLastResponse(page).catch(() => "");
      if (current && current === previous) return;
      previous = current;
      await page.waitForTimeout(400).catch(() => undefined);
    }
  }

  /** Read the text of the latest assistant message. */
  async captureLastResponse(page: Page): Promise<string> {
    const last = page.locator(this.profile.assistantSelector).last();
    return (await last.innerText().catch(() => "")).trim();
  }

  /** Count rendered assistant messages. */
  async countAssistantResponses(page: Page): Promise<number> {
    return page
      .locator(this.profile.assistantSelector)
      .count()
      .catch(() => 0);
  }

  /** Capture the transcript as role-tagged messages (assistant, plus user when known). */
  async captureAllMessages(page: Page): Promise<Array<{ role: string; content: string }>> {
    const assistant = await page
      .locator(this.profile.assistantSelector)
      .allInnerTexts()
      .catch(() => [] as string[]);
    const messages = assistant.map((content) => ({ role: "assistant", content: content.trim() }));
    if (!this.profile.userSelector) return messages;
    const user = await page
      .locator(this.profile.userSelector)
      .allInnerTexts()
      .catch(() => [] as string[]);
    return [...user.map((content) => ({ role: "user", content: content.trim() })), ...messages];
  }

  /** No stable generic sidebar affordance — return empty. LIVE-VERIFY per provider. */
  async readSidebarConversations(): Promise<Array<{ id: string; title: string; url: string }>> {
    return [];
  }

  /** Open a conversation by URL. */
  async navigateToConversation(page: Page, url: string): Promise<void> {
    await page.goto(url, { waitUntil: "domcontentloaded" });
  }

  /** Start a new conversation by returning to the default URL. */
  async newConversation(page: Page): Promise<void> {
    await page.goto(this.defaultUrl, { waitUntil: "domcontentloaded" });
  }

  /** Best-effort: report the configured default model. LIVE-VERIFY per provider. */
  async detectCurrentModel(): Promise<string> {
    return this.defaultModel;
  }

  /** No stable generic model picker — return empty. LIVE-VERIFY per provider. */
  async listAvailableModels(): Promise<ModelOption[]> {
    return [];
  }

  /** No stable generic model switch — keep the current model. LIVE-VERIFY per provider. */
  async selectModel(): Promise<string> {
    return this.defaultModel;
  }

  /** Prompt rewind is not supported generically. */
  async rewindLastUserPrompt(): Promise<void> {
    throw new Error(`${this.displayName}: rewinding the last prompt is not supported.`);
  }

  /** Click the stop-generating control if the profile defines one. */
  async stopGenerating(page: Page, timeout = 5_000): Promise<boolean> {
    if (!this.profile.stopSelector) return false;
    const stop = page.locator(this.profile.stopSelector).first();
    const visible = await stop.isVisible({ timeout }).catch(() => false);
    if (!visible) return false;
    await stop.click({ timeout }).catch(() => undefined);
    return true;
  }

  /** File attachment is not supported generically. */
  async attachFilesToPrompt(): Promise<void> {
    throw new Error(`${this.displayName}: attaching files is not supported.`);
  }

  /** Heuristic: a short label containing a known model keyword. */
  isLikelyModelLabel(value: string): boolean {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed || trimmed.length > 40) return false;
    return MODEL_KEYWORDS.some((keyword) => trimmed.includes(keyword));
  }
}
