import type { Page } from "playwright";
import { DESIGN_HOME_URL, designProjectUrl, projectIdFromDesignUrl } from "./designRpc.ts";

// LIVE-VERIFIED 2026-10-02 against claude.ai/design.
export const DESIGN_SELECTORS = {
  homeComposer: '[data-testid="home-composer-input"]',
  homeSend: '[data-testid="home-composer-send"]',
  chatComposer: '[data-testid="chat-composer-input"]',
  chatSend: '[data-testid="chat-send-button"]',
  stop: '[data-testid="pill-stop-button"]',
  modelButton: '[data-testid="model-selector-button"]',
  chatHistory: '[data-testid="nav-chat-history"]',
  importButton: '[data-testid="composer-import-button"]',
  projectTitle: '[data-testid="project-title"]',
  projectRow: '[data-testid="project-row"]',
  menu: '[role="menu"]',
} as const;

const TAB_READY_MS = 45_000;

// Turns this process started through the engine, keyed to the message count before the
// prompt. Engine shutdown stops only these, never a turn the user (or another bridge
// process) is running in the same Chrome.
const engineTurns = new WeakMap<Page, number>();

export const markDesignTurnStarted = (page: Page, messageCount: number): void => {
  engineTurns.set(page, messageCount);
};

export const markDesignTurnSettled = (page: Page): void => {
  engineTurns.delete(page);
};

export const designTurnMessageCount = (page: Page): number | undefined => engineTurns.get(page);

export const isDesignTabBusy = async (page: Page): Promise<boolean> => {
  return page
    .locator(DESIGN_SELECTORS.stop)
    .first()
    .isVisible()
    .catch(() => false);
};

export const designProjectTabs = (page: Page, projectId: string): Page[] => {
  return page
    .context()
    .pages()
    .filter((candidate) => projectIdFromDesignUrl(candidate.url()) === projectId);
};

export const assertDesignProjectIdle = async (page: Page, projectId: string): Promise<void> => {
  for (const projectTab of designProjectTabs(page, projectId)) {
    if (await isDesignTabBusy(projectTab)) {
      throw new Error(
        `Claude Design project ${projectId} is running a turn — wait for it to finish (design read) and retry.`,
      );
    }
  }
};

// One tab per project: reuse the project's open tab, else open one beside the engine page.
export const openDesignProjectTab = async (page: Page, projectId: string): Promise<Page> => {
  const [openTab] = designProjectTabs(page, projectId);
  let projectTab = openTab;
  if (projectTab === undefined) {
    projectTab = await page.context().newPage();
    await projectTab.goto(designProjectUrl(projectId), { waitUntil: "domcontentloaded" });
  }
  await projectTab.bringToFront();
  await projectTab.waitForSelector(DESIGN_SELECTORS.chatComposer, { timeout: TAB_READY_MS });
  return projectTab;
};

export const openDesignHomeTab = async (page: Page): Promise<Page> => {
  const homeTab = await page.context().newPage();
  await homeTab.goto(DESIGN_HOME_URL, { waitUntil: "domcontentloaded" });
  await homeTab.bringToFront();
  await homeTab.waitForSelector(DESIGN_SELECTORS.homeComposer, { timeout: TAB_READY_MS });
  return homeTab;
};

const isDesignHomeUrl = (url: string): boolean => {
  if (!URL.canParse(url)) return false;
  return new URL(url).href.split(/[?#]/u)[0] === DESIGN_HOME_URL;
};

// The project's tab, or an open home tab (else a new one) when no project is named.
export const openDesignComposerTab = async (
  page: Page,
  projectId: string | undefined,
): Promise<Page> => {
  if (projectId !== undefined) return openDesignProjectTab(page, projectId);
  const homeTab = page
    .context()
    .pages()
    .find((candidate) => isDesignHomeUrl(candidate.url()));
  if (homeTab === undefined) return openDesignHomeTab(page);
  await homeTab.bringToFront();
  await homeTab.waitForSelector(DESIGN_SELECTORS.homeComposer, { timeout: TAB_READY_MS });
  return homeTab;
};
