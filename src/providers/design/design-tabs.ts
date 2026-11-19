import type { Page } from "playwright";
import {
  DESIGN_HOME_URL,
  readDesignProjectUrl,
  readProjectIdFromDesignUrl,
} from "@/providers/design/design-rpc.ts";
import { probeOrFallback } from "@/providers/engine/browser-provider.ts";
import { HTML_PARSED_WAIT } from "@/providers/engine/page-probes.ts";

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

const TAB_READY_MILLISECONDS = 45_000;

// Shutdown stops only the turns this process started, never another turn in the same Chrome.
const engineTurns = new WeakMap<Page, number>();

export class DesignTabs {
  constructor(private readonly page: Page) {}

  markDesignTurnStarted = (messageCount: number): void => {
    engineTurns.set(this.page, messageCount);
  };

  markDesignTurnSettled = (): void => {
    engineTurns.delete(this.page);
  };

  readDesignTurnMessageCount = (): number | undefined => {
    return engineTurns.get(this.page);
  };

  isDesignTabBusy = async (): Promise<boolean> => {
    return probeOrFallback(false, () =>
      this.page.locator(DESIGN_SELECTORS.stop).first().isVisible(),
    );
  };

  listDesignProjectTabs = (projectId: string): Page[] => {
    return this.page
      .context()
      .pages()
      .filter((candidate) => readProjectIdFromDesignUrl(candidate.url()) === projectId);
  };

  assertDesignProjectIdle = async (projectId: string): Promise<void> => {
    for (const projectTab of this.listDesignProjectTabs(projectId)) {
      const isProjectTabBusy = await new DesignTabs(projectTab).isDesignTabBusy();
      if (isProjectTabBusy) {
        throw new Error(
          `Claude Design project ${projectId} is running a turn — wait for it to finish (design read) and retry.`,
        );
      }
    }
  };

  // One tab per project: reuse the project's open tab, else open one beside the engine page.
  private openNewProjectTab = async (projectId: string): Promise<Page> => {
    const newProjectTab = await this.page.context().newPage();
    const projectUrl = readDesignProjectUrl(projectId);
    await newProjectTab.goto(projectUrl, { waitUntil: HTML_PARSED_WAIT });
    return newProjectTab;
  };

  openDesignProjectTab = async (projectId: string): Promise<Page> => {
    const [openTab] = this.listDesignProjectTabs(projectId);
    const projectTab = openTab ?? (await this.openNewProjectTab(projectId));

    await projectTab.bringToFront();
    await projectTab.waitForSelector(DESIGN_SELECTORS.chatComposer, {
      timeout: TAB_READY_MILLISECONDS,
    });
    return projectTab;
  };

  openDesignHomeTab = async (): Promise<Page> => {
    const homeTab = await this.page.context().newPage();
    await homeTab.goto(DESIGN_HOME_URL, { waitUntil: HTML_PARSED_WAIT });
    await homeTab.bringToFront();
    await homeTab.waitForSelector(DESIGN_SELECTORS.homeComposer, {
      timeout: TAB_READY_MILLISECONDS,
    });
    return homeTab;
  };

  // The project's tab, or an open home tab (else a new one) when no project is named.
  openDesignComposerTab = async (projectId: string | undefined): Promise<Page> => {
    const hasProjectId = projectId != null;
    if (hasProjectId) return this.openDesignProjectTab(projectId);

    const homeTab = this.page
      .context()
      .pages()
      .find((candidate) => isDesignHomeUrl(candidate.url()));

    const isHomeTabMissing = homeTab == null;
    if (isHomeTabMissing) return this.openDesignHomeTab();

    await homeTab.bringToFront();
    await homeTab.waitForSelector(DESIGN_SELECTORS.homeComposer, {
      timeout: TAB_READY_MILLISECONDS,
    });
    return homeTab;
  };
}

function isDesignHomeUrl(url: string): boolean {
  const isNotUrlParse = !URL.canParse(url);
  if (isNotUrlParse) return false;

  return new URL(url).href.split(/[?#]/u)[0] === DESIGN_HOME_URL;
}
