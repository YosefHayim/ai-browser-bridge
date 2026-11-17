import type { Locator, Page } from "playwright";
import { searchChatGptConversationByTitle } from "@/providers/chatgpt/backend-api/chatgpt-conversation-search.ts";
import {
  looksLikeConversationId,
  readChatGptConversationIdFromUrl,
  stripConversationId,
} from "@/providers/chatgpt/backend-api/chatgpt-conversation-url.ts";
import {
  CHATGPT_MENU_ITEM,
  ChatGptPageControls,
  isMenuElementShown,
} from "@/providers/chatgpt/backend-api/chatgpt-page-controls.ts";
import type { ArchiveChatVerdict } from "@/providers/chatgpt/backend-api/chatgpt-workspace-types.ts";
import { probeOrFallback } from "@/providers/engine/browser-provider.ts";
import { VISIBLE_WAIT_MODE } from "@/providers/engine/page-probes.ts";

const chatLinkSelector = 'nav a[href*="/c/"]';
const activeConversationMenuSelector =
  '[data-testid="conversation-options-button"], button[aria-label="Chat actions"][aria-haspopup="menu"]';
const sidebarOptionsButtonSelector =
  'button[aria-label="Chat actions"], button[aria-label^="Open conversation options"]';
const chatOrigin = "https://chatgpt.com";
const scrollStepPixels = 800;
const scrollSlackPixels = 20;
const pollMilliseconds = 250;
const hoverSettleMilliseconds = 200;
const archiveOptionShownMilliseconds = 2_000;
const afterArchiveClickMilliseconds = 600;
const scrollSettleMilliseconds = 220;
const triggerShownMilliseconds = 500;
const stableCountNeeded = 4;
const maxScrollSteps = 80;
const maxMenuOpenAttempts = 2;
const maxActiveConversationAttempts = 20;

type SidebarScroll = {
  readonly navTag: string;
  readonly linkSelector: string;
  readonly slackPixels: number;
  readonly stepPixels: number | null;
};

export class ChatGptChatMenu {
  private readonly controls: ChatGptPageControls;

  constructor(private readonly page: Page) {
    this.controls = new ChatGptPageControls(page);
  }

  archiveChat = async (chat: string): Promise<ArchiveChatVerdict> => {
    const base: ArchiveChatVerdict = { chat, archived: false };

    const didConversationMenuOpen = await this.openConversationMenu(chat);

    const isConversationMenuNotOpened = !didConversationMenuOpen;
    if (isConversationMenuNotOpened) {
      return { ...base, reason: "could not open the chat ⋯ menu" };
    }

    const archiveElement = this.page
      .locator(`${CHATGPT_MENU_ITEM}:visible`)
      .filter({ hasText: /^archive$/i })
      .first();
    const isArchiveElementShown = await probeOrFallback(false, () =>
      archiveElement.isVisible({ timeout: archiveOptionShownMilliseconds }),
    );

    const isArchiveElementHidden = !isArchiveElementShown;
    if (isArchiveElementHidden) {
      await this.controls.dismissMenu();
      return { ...base, reason: "no 'Archive' option for this chat" };
    }

    await archiveElement.click();
    await this.page.waitForTimeout(afterArchiveClickMilliseconds);
    return { ...base, archived: true };
  };

  // Sidebar is virtualized: open the conversation so its active row mounts, then scroll.
  private findChatLine = async (chat: string): Promise<Locator | null> => {
    const id = stripConversationId(chat);
    const byHref = this.page.locator(`nav a[href*="/c/${id}"]`).first();
    const byTitle = this.page.locator(chatLinkSelector, { hasText: chat }).first();

    const hasHrefHit = (await byHref.count()) > 0;
    if (hasHrefHit) return byHref;

    const looksLikeId = looksLikeConversationId(id);

    const isIdMissingFromUrl = looksLikeId && !this.page.url().includes(`/c/${id}`);
    if (isIdMissingFromUrl) {
      await this.controls.gotoStable(`${chatOrigin}/c/${id}`);

      const hasHrefHitAfterWait = (await byHref.count()) > 0;
      if (hasHrefHitAfterWait) return byHref;

      const isConversationMenuActive = await this.waitForActiveConversationMenu(id);
      if (isConversationMenuActive) return null;
    }

    const hasTitleHit = (await byTitle.count()) > 0;
    if (hasTitleHit) return byTitle;

    const isConversationMenuOpenById =
      looksLikeId && (await this.waitForActiveConversationMenu(id));
    if (isConversationMenuOpenById) return null;

    // Reset to top: a prior multi-chat op can leave the list scrolled mid-history.
    await this.scrollSidebar(null);
    await this.page.waitForTimeout(pollMilliseconds);
    return this.scrollToChatLine(byHref, byTitle);
  };

  // Stop only once the rendered-link count stops growing, not after one no-op scroll.
  private scrollToChatLine = async (byHref: Locator, byTitle: Locator): Promise<Locator | null> => {
    let previousCount = -1;
    let stable = 0;
    for (let step = 0; step < maxScrollSteps && stable < stableCountNeeded; step += 1) {
      const hasHrefLine = (await byHref.count()) > 0;
      if (hasHrefLine) return byHref;

      const hasTitleLine = (await byTitle.count()) > 0;
      if (hasTitleLine) return byTitle;

      await this.scrollSidebar(scrollStepPixels);
      await this.page.waitForTimeout(scrollSettleMilliseconds);

      const count = await this.page.locator(chatLinkSelector).count();

      const isCountUnchanged = count === previousCount;
      stable = isCountUnchanged ? stable + 1 : 0;
      previousCount = count;
    }
    return null;
  };

  private scrollSidebar = async (stepPixels: number | null): Promise<void> => {
    const scroll: SidebarScroll = {
      navTag: "nav",
      linkSelector: chatLinkSelector,
      slackPixels: scrollSlackPixels,
      stepPixels,
    };
    await this.page.evaluate((sidebarScroll) => {
      function findScrollableNav(start: Element | null): Element | null {
        const isNavFound =
          start == null || start.scrollHeight > start.clientHeight + sidebarScroll.slackPixels;
        if (isNavFound) return start;

        return findScrollableNav(start.parentElement);
      }
      const anchor = document.querySelector(sidebarScroll.linkSelector);
      const isAnchorFound = anchor != null;
      const startNav = isAnchorFound
        ? anchor.closest(sidebarScroll.navTag)
        : document.querySelector(sidebarScroll.navTag);
      const navElement = findScrollableNav(startNav);
      const scrollTarget = navElement ?? document.scrollingElement;

      const isScrollTargetMissing = scrollTarget == null;
      if (isScrollTargetMissing) return;

      const isScrollToTop = sidebarScroll.stepPixels == null;
      if (isScrollToTop) scrollTarget.scrollTo(0, 0);
      else scrollTarget.scrollBy(0, sidebarScroll.stepPixels);
    }, scroll);
  };

  // A sticky header intercepts coordinate clicks, so dispatch pointerdown on the element.
  private openChatMenu = async (line: Locator): Promise<boolean> => {
    const lineWithSettings = line.locator(
      `xpath=ancestor-or-self::*[.//button[${'@aria-label="Chat actions" or starts-with(@aria-label, "Open conversation options")'}]][1]`,
    );
    const hasLineWithSettings = (await lineWithSettings.count()) > 0;
    const scope = hasLineWithSettings ? lineWithSettings : line;
    await probeOrFallback(null, () => scope.hover());
    await this.page.waitForTimeout(hoverSettleMilliseconds);
    const settingsButton = scope.locator(sidebarOptionsButtonSelector).first();

    const isSettingsButtonMissing = (await settingsButton.count()) === 0;
    if (isSettingsButtonMissing) return false;

    return probeOrFallback(false, async () => {
      await this.controls.firePointerDown(settingsButton);
      return isMenuElementShown(this.page.locator(`${CHATGPT_MENU_ITEM}:visible`).first());
    });
  };

  private openConversationMenu = async (chat: string): Promise<boolean> => {
    let targetConversationId = stripConversationId(chat);

    const targetLooksLikeId = looksLikeConversationId(targetConversationId);
    const openPageUrl = this.page.url();

    const isTargetConversationOpen =
      targetLooksLikeId &&
      readChatGptConversationIdFromUrl(openPageUrl) === targetConversationId &&
      (await this.openActiveConversationMenu(targetConversationId));
    if (isTargetConversationOpen) return true;

    const line = await this.findChatLine(chat);

    const isChatLineFound = line != null;
    if (isChatLineFound) {
      const isSidebarMenuOpen = await this.openChatMenu(line);

      const shouldTryHeaderMenu = !isSidebarMenuOpen && targetLooksLikeId;

      const isHeaderMenuSkipped = !shouldTryHeaderMenu;
      if (isHeaderMenuSkipped) return isSidebarMenuOpen;

      await this.controls.gotoStable(`${chatOrigin}/c/${targetConversationId}`);
      return this.openActiveConversationMenu(targetConversationId);
    }

    const isNotTargetLooksLikeId = !targetLooksLikeId;
    if (isNotTargetLooksLikeId) {
      const exactReport = await searchChatGptConversationByTitle(this.page, chat);

      const isExactMissing = exactReport == null;
      if (isExactMissing) return false;

      targetConversationId = exactReport.id;
      await this.controls.gotoStable(exactReport.url);
    }

    return this.openActiveConversationMenu(targetConversationId);
  };

  private openActiveConversationMenu = async (targetConversationId: string): Promise<boolean> => {
    const isActiveConversationMenuShown =
      await this.waitForActiveConversationMenu(targetConversationId);

    const isConversationMenuStillClosed = !isActiveConversationMenuShown;
    if (isConversationMenuStillClosed) return false;

    const trigger = this.page.locator(activeConversationMenuSelector).first();
    for (let attempt = 0; attempt < maxMenuOpenAttempts; attempt += 1) {
      const isFirstAttempt = attempt === 0;
      if (isFirstAttempt) {
        await probeOrFallback(null, () => trigger.click());
      } else {
        await this.controls.dismissMenu();
        await probeOrFallback(null, () =>
          this.controls.firePointerDown(trigger, archiveOptionShownMilliseconds),
        );
      }

      const isMenuVisible = await probeOrFallback(false, () =>
        isMenuElementShown(this.page.locator(`${CHATGPT_MENU_ITEM}:visible`).first()),
      );
      if (isMenuVisible) return true;
    }
    return false;
  };

  private waitForActiveConversationMenu = async (conversationId: string): Promise<boolean> => {
    const trigger = this.page.locator(activeConversationMenuSelector).first();
    for (let attempt = 0; attempt < maxActiveConversationAttempts; attempt += 1) {
      const activeConversationId = readChatGptConversationIdFromUrl(this.page.url());

      const isConversationActive = activeConversationId === conversationId;
      if (isConversationActive) {
        // ChatGPT can update the project-scoped URL before mounting the header controls.
        const isTriggerShown = await probeOrFallback(false, async () => {
          await trigger.waitFor({ state: VISIBLE_WAIT_MODE, timeout: triggerShownMilliseconds });
          return true;
        });
        if (isTriggerShown) return true;
      }

      await this.page.waitForTimeout(pollMilliseconds);
    }
    return false;
  };
}
