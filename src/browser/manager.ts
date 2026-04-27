import { chromium, type Browser, type BrowserContext, type Page, type Response } from "playwright";
import type { Conversation } from "../types/types.ts";

/** Manages the Playwright browser instance connected to the user's Chrome profile. */
export class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private conversations: Conversation[] = [];

  /** Launch browser with the user's Chrome profile so ChatGPT login is preserved. */
  async launch(profilePath?: string): Promise<Page> {
    if (this.browser) await this.close();

    this.browser = await chromium.launch({ headless: false });

    const contextOpts: Record<string, unknown> = {};
    if (profilePath) {
      contextOpts.userDataDir = profilePath;
    }

    this.context = await this.browser.newContext(contextOpts);

    // Intercept ChatGPT API responses to extract conversation IDs
    this.context.on("response", (response: Response) => {
      this.interceptConversationResponse(response).catch(() => {});
    });

    this.page = await this.context.newPage();
    await this.page.goto("https://chatgpt.com");
    return this.page;
  }

  /**
   * Intercept ChatGPT backend API responses.
   *
   * ChatGPT's sidebar fetches conversations from:
   *   GET https://chatgpt.com/backend-api/conversations?offset=0&limit=28
   *
   * The response is JSON: { items: [{ id, title, ... }], total, ... }
   * The `id` is a MongoDB ObjectId used as the conversation UUID in URLs: /c/{id}
   */
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

  /** Get cached conversations extracted from API interception. */
  getConversations(): Conversation[] {
    return this.conversations;
  }

  /** Find a conversation by its MongoDB ID (full or partial match). */
  findConversation(idPrefix: string): Conversation | undefined {
    return this.conversations.find((c) => c.id.startsWith(idPrefix));
  }

  /** Get the active page. Throws if browser hasn't been launched. */
  getPage(): Page {
    if (!this.page) throw new Error("Browser not launched. Call launch() first.");
    return this.page;
  }

  /** Close the browser. */
  async close(): Promise<void> {
    await this.page?.close();
    await this.context?.close();
    await this.browser?.close();
    this.page = null;
    this.context = null;
    this.browser = null;
  }
}
