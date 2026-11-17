import type { Locator, Page } from "playwright";
import type { ConversationSearchReport } from "@/conversation-catalog/conversation-catalog-schemas.ts";
import {
  CHATGPT_SEARCH,
  type ChatGptSearchLine,
  isSearchLineForQuery,
  readChatGptSearchReport,
} from "@/providers/chatgpt/backend-api/chatgpt-search-replies.ts";
import { probeOrFallback } from "@/providers/engine/browser-provider.ts";
import { VISIBLE_WAIT_MODE } from "@/providers/engine/page-probes.ts";

const scrollSlackPixels = 20;
const dialogOpenMilliseconds = 8_000;
const reportsPollMilliseconds = 250;
const reportsPollCount = 12;
const renderPollCount = 20;
const maxUnchangedScrolls = 2;

type ScrollTarget = {
  readonly dialogSelector: string;
  readonly slackPixels: number;
  readonly toBottom: boolean;
};

export async function dismissChatGptHistoryRateLimit(page: Page): Promise<boolean> {
  const isClosedPage = page.isClosed();
  if (isClosedPage) return false;

  const modal = page.locator(CHATGPT_SEARCH.rateLimit).first();
  const isModalVisible = await modal.isVisible();

  const isModalHidden = !isModalVisible;
  if (isModalHidden) return false;

  const acknowledge = modal.getByRole("button", { name: "Got it", exact: true }).first();

  const isAcknowledgeVisible = await acknowledge.isVisible();
  if (isAcknowledgeVisible) {
    await acknowledge.evaluate((button) => {
      const isButtonElement = button instanceof HTMLElement;
      if (isButtonElement) button.click();
    });
  }

  // The caller bounds repeated cooldowns if ChatGPT leaves the modal mounted.
  await probeOrFallback(null, async () => {
    const modalHiddenMilliseconds = 3_000;

    await modal.waitFor({ state: "hidden", timeout: modalHiddenMilliseconds });
  });
  return true;
}

export class ChatGptSearchDialog {
  constructor(private readonly page: Page) {}

  open = async (): Promise<Locator> => {
    await this.close();
    const trigger = this.page.locator(CHATGPT_SEARCH.trigger).filter({ visible: true }).first();
    await trigger.waitFor({ state: VISIBLE_WAIT_MODE, timeout: dialogOpenMilliseconds });
    await trigger.evaluate((button) => {
      const isButtonElement = button instanceof HTMLElement;
      if (isButtonElement) button.click();
    });
    const dialog = this.page.locator(CHATGPT_SEARCH.dialog).first();
    await dialog.waitFor({ state: VISIBLE_WAIT_MODE, timeout: dialogOpenMilliseconds });

    const chatsTab = dialog.getByRole("tab", { name: "Chats", exact: true });

    const isChatsTabVisible = await chatsTab.isVisible();
    if (isChatsTabVisible) await chatsTab.click();

    return dialog;
  };

  close = async (): Promise<void> => {
    const closeButton = this.page.getByRole("button", {
      name: "Close global search",
      exact: true,
    });
    const isCloseButtonVisible = await closeButton.isVisible();

    const isCloseButtonHidden = !isCloseButtonVisible;
    if (isCloseButtonHidden) return;

    await closeButton.evaluate((button) => {
      const isButtonElement = button instanceof HTMLElement;
      if (isButtonElement) button.click();
    });
  };

  assertAvailable = async (): Promise<void> => {
    const isRateLimitVisible = await this.page.locator(CHATGPT_SEARCH.rateLimit).isVisible();

    const isRateLimitHidden = !isRateLimitVisible;
    if (isRateLimitHidden) return;

    throw new Error(
      "ChatGPT conversation search is temporarily rate-limited. Wait a few minutes and try again.",
    );
  };

  waitForReports = async (dialog: Locator, query: string): Promise<void> => {
    for (let poll = 0; poll < renderPollCount; poll += 1) {
      await this.assertAvailable();
      const queryLines = await this.findLines(dialog, query);

      const hasQueryLines = queryLines.length > 0;
      if (hasQueryLines) return;

      await this.page.waitForTimeout(reportsPollMilliseconds);
    }
    throw new Error("ChatGPT found matching chats but did not show them in Search.");
  };

  resetScroll = async (dialog: Locator): Promise<void> => {
    await this.scrollReportList(dialog, false);
  };

  // Scrolls the result list down and keeps collecting until the count stops growing or the limit is reached.
  collectReports = async (
    dialog: Locator,
    query: string,
    limit: number,
  ): Promise<ConversationSearchReport[]> => {
    const reportsById = new Map<string, ConversationSearchReport>();
    let unchangedScrolls = 0;
    while (reportsById.size < limit && unchangedScrolls < maxUnchangedScrolls) {
      await this.collectVisibleReports(dialog, query, reportsById);

      const isLimitReached = reportsById.size >= limit;
      if (isLimitReached) break;

      const reportCountBeforeScroll = reportsById.size;

      const isScrolled = await this.scrollReportList(dialog, true);

      const isScrollFailed = !isScrolled;
      if (isScrollFailed) break;

      await this.pollForNewReports(dialog, query, reportsById, reportCountBeforeScroll);

      const isReportCountUnchanged = reportsById.size === reportCountBeforeScroll;
      unchangedScrolls = isReportCountUnchanged ? unchangedScrolls + 1 : 0;
    }
    return Array.from(reportsById.values()).slice(0, limit);
  };

  private pollForNewReports = async (
    dialog: Locator,
    query: string,
    reportsById: Map<string, ConversationSearchReport>,
    reportCountBeforeScroll: number,
  ): Promise<void> => {
    for (let poll = 0; poll < reportsPollCount; poll += 1) {
      const hasNewReports = reportsById.size !== reportCountBeforeScroll;
      if (hasNewReports) return;

      await this.page.waitForTimeout(reportsPollMilliseconds);
      await this.collectVisibleReports(dialog, query, reportsById);
    }
  };

  private findLines = async (dialog: Locator, query: string): Promise<ChatGptSearchLine[]> => {
    const lines = await this.readLines(dialog);
    return lines.filter((line) => isSearchLineForQuery({ entry: line, query }));
  };

  private readLines = async (dialog: Locator): Promise<ChatGptSearchLine[]> =>
    dialog.locator(CHATGPT_SEARCH.resultLink).evaluateAll(
      (links, titleSelector) =>
        links.flatMap((link) => {
          const href = link.getAttribute("href");

          const isHrefMissing = href == null;
          if (isHrefMissing) return [];

          const titleNode = link.querySelector(titleSelector);
          const isLinkElement = link instanceof HTMLElement;
          // biome-ignore lint/performance/useDomNodeTextContent: the fallback title must match what the user sees
          const fallbackTitle = isLinkElement ? link.innerText.split("\n")[0] : "";
          const unparsedTitle = titleNode?.textContent ?? fallbackTitle ?? "";

          const title = unparsedTitle.trim();
          const isTitleFound = title !== "";
          return isTitleFound ? [{ href, title }] : [];
        }),
      CHATGPT_SEARCH.resultTitle,
    );

  private collectVisibleReports = async (
    dialog: Locator,
    query: string,
    reportsById: Map<string, ConversationSearchReport>,
  ): Promise<void> => {
    const lines = await this.findLines(dialog, query);
    for (const line of lines) {
      const report = readChatGptSearchReport(line, reportsById.size);

      const isHitUnseen = report != null && !reportsById.has(report.id);
      if (isHitUnseen) reportsById.set(report.id, report);
    }
  };

  // Returns true when scrolling down moved the list; scrolling to the top always returns false.
  private scrollReportList = async (dialog: Locator, toBottom: boolean): Promise<boolean> => {
    const firstReport = dialog.locator(CHATGPT_SEARCH.resultLink).first();
    const firstReportCount = await firstReport.count();

    const hasNoFirstReport = firstReportCount === 0;
    if (hasNoFirstReport) return false;

    const target: ScrollTarget = {
      dialogSelector: '[role="dialog"]',
      slackPixels: scrollSlackPixels,
      toBottom,
    };
    return firstReport.evaluate((reportLink, scrollTarget) => {
      const searchDialog = reportLink.closest(scrollTarget.dialogSelector);
      let scrollCandidate = reportLink.parentElement;
      while (scrollCandidate && searchDialog?.contains(scrollCandidate)) {
        const isScrollable =
          scrollCandidate.scrollHeight > scrollCandidate.clientHeight + scrollTarget.slackPixels;
        if (isScrollable) {
          const previousScrollTop = scrollCandidate.scrollTop;
          scrollCandidate.scrollTo(0, scrollTarget.toBottom ? scrollCandidate.scrollHeight : 0);
          return scrollTarget.toBottom && scrollCandidate.scrollTop > previousScrollTop;
        }

        scrollCandidate = scrollCandidate.parentElement;
      }
      return false;
    }, target);
  };
}
