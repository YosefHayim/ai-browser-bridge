import type { Page } from "playwright";
import { DEFAULT_ASK_TIMEOUT_SECONDS, PROVIDER_CONFIG } from "@/config";
import type { ModelOption } from "@/features/domain";
import type { BrowserProvider, ResponseWaitOptions } from "../browserProvider.ts";
import {
  attachDesignFiles,
  chooseDesignModel,
  currentDesignModel,
  readDesignModels,
  typeIntoDesignComposer,
} from "./designComposer.ts";
import {
  readActiveDesignMessages,
  startNewDesignConversation,
  waitForDesignTurn,
} from "./designConversation.ts";
import { listDesignProjects } from "./designProjects.ts";
import { projectIdFromDesignUrl } from "./designRpc.ts";
import {
  assertDesignProjectIdle,
  DESIGN_SELECTORS,
  designTurnMessageCount,
  isDesignTabBusy,
  markDesignTurnSettled,
  markDesignTurnStarted,
} from "./designTabs.ts";

const PROFILE = PROVIDER_CONFIG.design;
const SIGNED_IN_WAIT_MS = 30_000;
const IDLE_WAIT_MS = 60_000;
const PROJECT_URL_WAIT_MS = 60_000;
const SIDEBAR_PROJECT_LIMIT = 100;
const MODEL_LABEL = /^(Fable|Opus|Sonnet|Haiku)\b/iu;

export const DESIGN_PAGE_KINDS = ["home", "project", "other"] as const;
export type DesignPageKind = (typeof DESIGN_PAGE_KINDS)[number];

export type DesignTabState = {
  readonly url: string;
  readonly projectId: string | undefined;
  readonly busy: boolean;
};

export type DesignState = {
  readonly page: DesignPageKind;
  readonly url: string;
  readonly projectId: string | undefined;
  readonly projectTitle: string | undefined;
  readonly model: string | undefined;
  readonly busy: boolean;
  readonly tabs: readonly DesignTabState[];
  readonly actions: readonly string[];
  readonly manual: readonly string[];
};

const HOME_ACTIONS = ["projects", "catalog", "model", "create", "open"] as const;
const PROJECT_ACTIONS = [
  "read",
  "send",
  "new-conversation",
  "rename-conversation",
  "files",
  "put",
  "rm",
  "download",
  "export",
  "share",
  "rename",
  "duplicate",
  "favorite",
  "use-design-systems",
  "delete",
] as const;

// Share-panel destinations the bridge lists but leaves to the person at the keyboard.
export const DESIGN_MANUAL_ACTIONS = [
  "Publish as artifact",
  "Send to Claude Code",
  "PNG, video, PDF and PowerPoint export",
  "Partner app exports (Connect)",
  "Comments",
  "Version restore",
] as const;

const isDesignUrl = (url: string): boolean => {
  if (!URL.canParse(url)) return false;
  const { hostname, pathname } = new URL(url);
  if (hostname !== PROFILE.origin) return false;
  return pathname === PROFILE.pathPrefix || pathname.startsWith(`${PROFILE.pathPrefix}/`);
};

const designPageKind = (url: string): DesignPageKind => {
  if (!isDesignUrl(url)) return "other";
  if (projectIdFromDesignUrl(url) !== undefined) return "project";
  return "home";
};

const assertSignedIn = async (page: Page): Promise<void> => {
  if (!isDesignUrl(page.url())) {
    await page.goto(PROFILE.defaultUrl, { waitUntil: "domcontentloaded" });
  }
  const ready = await page
    .waitForSelector(PROFILE.selectors.composer, { timeout: SIGNED_IN_WAIT_MS })
    .then(
      () => true,
      () => false,
    );
  if (ready) return;
  throw new Error(
    `${PROFILE.displayName}: no composer at ${page.url()} — sign in at claude.ai in the bridge Chrome.`,
  );
};

const waitUntilIdle = async (page: Page): Promise<void> => {
  const deadline = Date.now() + IDLE_WAIT_MS;
  while (await isDesignTabBusy(page)) {
    if (Date.now() > deadline) {
      throw new Error(`${PROFILE.displayName}: a turn is still running in this project.`);
    }
    await page.waitForTimeout(1_000);
  }
};

const activeMessages = async (page: Page) => {
  const projectId = projectIdFromDesignUrl(page.url());
  if (projectId === undefined) return [];
  return readActiveDesignMessages(page, projectId);
};

// On home the prompt creates a new project; on a project tab it continues the active
// Conversation once the tab is idle.
const injectPrompt = async (page: Page, text: string): Promise<void> => {
  if (designPageKind(page.url()) === "project") {
    await waitUntilIdle(page);
    const projectId = projectIdFromDesignUrl(page.url());
    if (projectId !== undefined) await assertDesignProjectIdle(page, projectId);
    const messageCount = (await activeMessages(page)).length;
    await typeIntoDesignComposer(page, {
      selector: DESIGN_SELECTORS.chatComposer,
      text,
      append: false,
    });
    await page.locator(DESIGN_SELECTORS.chatSend).click();
    markDesignTurnStarted(page, messageCount);
    return;
  }
  await typeIntoDesignComposer(page, {
    selector: DESIGN_SELECTORS.homeComposer,
    text,
    append: false,
  });
  await page.locator(DESIGN_SELECTORS.homeSend).click();
  markDesignTurnStarted(page, 0);
};

const turnTimeoutMs = (waitOptions: number | ResponseWaitOptions | undefined): number => {
  if (typeof waitOptions === "number") return waitOptions;
  if (waitOptions?.timeout !== undefined) return waitOptions.timeout;
  return DEFAULT_ASK_TIMEOUT_SECONDS * 1000;
};

const waitForResponse = async (
  page: Page,
  waitOptions?: number | ResponseWaitOptions,
): Promise<void> => {
  const timeoutMs = turnTimeoutMs(waitOptions);
  await page.waitForURL((url) => projectIdFromDesignUrl(url.href) !== undefined, {
    timeout: PROJECT_URL_WAIT_MS,
  });
  const projectId = projectIdFromDesignUrl(page.url());
  if (projectId === undefined) throw new Error(`${PROFILE.displayName}: no project opened.`);
  let messageCount = designTurnMessageCount(page);
  if (messageCount === undefined) messageCount = (await activeMessages(page)).length;
  const outcome = await waitForDesignTurn(page, {
    projectId,
    conversationId: undefined,
    messageCount,
    model: undefined,
    autoDecide: false,
    timeoutMs,
  });
  if (outcome.status === "running") {
    throw new Error(`${PROFILE.displayName}: the turn is still running after ${timeoutMs} ms.`);
  }
  markDesignTurnSettled(page);
};

const captureLastResponse = async (page: Page): Promise<string> => {
  const replies = (await activeMessages(page)).filter((message) => message.role === "assistant");
  const lastReply = replies.at(-1);
  if (lastReply === undefined) return "";
  return lastReply.content;
};

const countAssistantResponses = async (page: Page): Promise<number> => {
  const messages = await activeMessages(page);
  return messages.filter((message) => message.role === "assistant").length;
};

const captureAllMessages = async (
  page: Page,
): Promise<Array<{ role: string; content: string }>> => {
  const messages = await activeMessages(page);
  return messages.map((message) => ({ role: message.role, content: message.content }));
};

const readSidebarConversations = async (
  page: Page,
): Promise<Array<{ id: string; title: string; url: string }>> => {
  const projects = await listDesignProjects(page, {
    kind: "projects",
    limit: SIDEBAR_PROJECT_LIMIT,
  });
  return projects.map((project) => ({ id: project.id, title: project.name, url: project.url }));
};

const assertTabIdle = async (page: Page): Promise<void> => {
  if (await isDesignTabBusy(page)) {
    throw new Error(`${PROFILE.displayName}: this tab is running a turn; leave it open.`);
  }
};

const navigateToConversation = async (page: Page, url: string): Promise<void> => {
  if (!isDesignUrl(url)) throw new Error(`${PROFILE.displayName}: not a Claude Design URL: ${url}`);
  await assertTabIdle(page);
  await page.goto(url, { waitUntil: "domcontentloaded" });
};

const newConversation = async (page: Page): Promise<void> => {
  await assertTabIdle(page);
  const projectId = projectIdFromDesignUrl(page.url());
  if (projectId === undefined) {
    await page.goto(PROFILE.defaultUrl, { waitUntil: "domcontentloaded" });
    return;
  }
  await startNewDesignConversation(page, projectId);
};

const detectCurrentModel = async (page: Page): Promise<string> => {
  const model = await currentDesignModel(page).catch(() => undefined);
  if (model === undefined) return PROFILE.defaultModel;
  return model;
};

const listAvailableModels = async (page: Page): Promise<ModelOption[]> => {
  const [models, current] = await Promise.all([readDesignModels(page), detectCurrentModel(page)]);
  return models.map((model) => ({
    id: model.id,
    label: model.label,
    selected: current.startsWith(model.label),
  }));
};

const selectModel = async (page: Page, query: string): Promise<string> => {
  const model = await chooseDesignModel(page, { model: query });
  if (model === undefined) return query;
  return model;
};

const rewindLastUserPrompt = async (): Promise<void> => {
  throw new Error(`${PROFILE.displayName}: rewinding the last prompt is not supported.`);
};

// Stops only a turn this process started through the engine (see designTabs.ts).
const stopGenerating = async (page: Page): Promise<boolean> => {
  if (designTurnMessageCount(page) === undefined) return false;
  markDesignTurnSettled(page);
  const stop = page.locator(DESIGN_SELECTORS.stop).first();
  if (!(await stop.isVisible().catch(() => false))) return false;
  await stop.click();
  return true;
};

const attachFilesToPrompt = async (page: Page, paths: string[]): Promise<void> => {
  await attachDesignFiles(page, paths);
};

const isLikelyModelLabel = (value: string): boolean => MODEL_LABEL.test(value.trim());

export const readDesignState = async (page: Page): Promise<DesignState> => {
  const kind = designPageKind(page.url());
  const designTabs = page
    .context()
    .pages()
    .filter((candidate) => isDesignUrl(candidate.url()));
  const [tabs, busy, model, projectTitle] = await Promise.all([
    Promise.all(
      designTabs.map(async (designTab) => ({
        url: designTab.url(),
        projectId: projectIdFromDesignUrl(designTab.url()),
        busy: await isDesignTabBusy(designTab),
      })),
    ),
    isDesignTabBusy(page),
    currentDesignModel(page).catch(() => undefined),
    page
      .locator(DESIGN_SELECTORS.projectTitle)
      .first()
      .innerText({ timeout: 1_000 })
      .then(
        (title) => title.trim(),
        () => undefined,
      ),
  ]);
  let actions: readonly string[] = HOME_ACTIONS;
  if (kind === "project") actions = [...HOME_ACTIONS, ...PROJECT_ACTIONS];
  return {
    page: kind,
    url: page.url(),
    projectId: projectIdFromDesignUrl(page.url()),
    projectTitle,
    model,
    busy,
    tabs,
    actions,
    manual: DESIGN_MANUAL_ACTIONS,
  };
};

export const designProvider = {
  id: "design",
  origin: PROFILE.origin,
  defaultUrl: PROFILE.defaultUrl,
  defaultModel: PROFILE.defaultModel,
  displayName: PROFILE.displayName,
  composerSelector: PROFILE.selectors.composer,
  supportsMcpConnector: PROFILE.supportsMcpConnector,
  assertSignedIn,
  injectPrompt,
  waitForResponse,
  captureLastResponse,
  countAssistantResponses,
  captureAllMessages,
  readSidebarConversations,
  navigateToConversation,
  newConversation,
  detectCurrentModel,
  listAvailableModels,
  selectModel,
  rewindLastUserPrompt,
  stopGenerating,
  attachFilesToPrompt,
  isLikelyModelLabel,
} satisfies BrowserProvider;
