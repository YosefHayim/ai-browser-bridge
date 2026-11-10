import type { Page } from "playwright";
import { DEFAULT_ASK_TIMEOUT_SECONDS, PROVIDER_SETTINGS } from "@/config";
import type { ModelOption } from "@/domain/connector-types.ts";
import type { BrowserProvider, ReplyWaitSettings } from "@/providers/browser-provider.ts";
import { probeOrFallback, readVisibleCopy } from "@/providers/browser-provider.ts";
import {
  attachDesignFiles,
  chooseDesignModel,
  readCurrentDesignModel,
  readDesignModels,
  typeIntoDesignComposer,
} from "./design-composer.ts";
import {
  readActiveDesignMessages,
  startNewDesignConversation,
  waitForDesignTurn,
} from "./design-conversation.ts";
import { listDesignProjects } from "./design-projects.ts";
import { readProjectIdFromDesignUrl } from "./design-rpc.ts";
import {
  assertDesignProjectIdle,
  DESIGN_SELECTORS,
  isDesignTabBusy,
  markDesignTurnSettled,
  markDesignTurnStarted,
  readDesignTurnMessageCount,
} from "./design-tabs.ts";

const ASSISTANT_ROLE = "assistant";

const HTML_PARSED_WAIT = "domcontentloaded";

const PROJECTS_KEY = "projects";

const OTHER_PAGE_KIND = "other";

const PROJECT_PAGE_KIND = "project";

const HOME_PAGE_KIND = "home";

const PROFILE = PROVIDER_SETTINGS.design;
const SIGNED_IN_WAIT_MILLISECONDS = 30_000;
const IDLE_WAIT_MILLISECONDS = 60_000;
const PROJECT_URL_WAIT_MILLISECONDS = 60_000;
const SIDEBAR_PROJECT_LIMIT = 100;

const DESIGN_PAGE_KINDS = [HOME_PAGE_KIND, PROJECT_PAGE_KIND, OTHER_PAGE_KIND] as const;
type DesignPageKind = (typeof DESIGN_PAGE_KINDS)[number];

type DesignTabStatus = {
  readonly url: string;
  readonly projectId: string | undefined;
  readonly busy: boolean;
};

export type DesignStatus = {
  readonly page: DesignPageKind;
  readonly url: string;
  readonly projectId: string | undefined;
  readonly projectTitle: string | undefined;
  readonly model: string | undefined;
  readonly busy: boolean;
  readonly tabs: readonly DesignTabStatus[];
  readonly actions: readonly string[];
  readonly manual: readonly string[];
};

const HOME_ACTIONS = [PROJECTS_KEY, "catalog", "model", "create", "open"] as const;

const isDesignUrl = (url: string): boolean => {
  const isNotUrlParse = !URL.canParse(url);
  if (isNotUrlParse) return false;

  const { hostname, pathname } = new URL(url);

  const isWrongHost = hostname !== PROFILE.origin;
  if (isWrongHost) return false;

  return pathname === PROFILE.pathPrefix || pathname.startsWith(`${PROFILE.pathPrefix}/`);
};

const readDesignPageKind = (url: string): DesignPageKind => {
  const isNotDesignUrlUrl = !isDesignUrl(url);
  if (isNotDesignUrlUrl) return OTHER_PAGE_KIND;

  const hasProjectId = readProjectIdFromDesignUrl(url) != null;
  if (hasProjectId) return PROJECT_PAGE_KIND;

  return HOME_PAGE_KIND;
};

const assertSignedIn = async (page: Page): Promise<void> => {
  const pageUrl = page.url();

  const isNotDesignUrl = !isDesignUrl(pageUrl);
  if (isNotDesignUrl) {
    await page.goto(PROFILE.defaultUrl, { waitUntil: HTML_PARSED_WAIT });
  }

  const ready = await probeOrFallback(false, async () => {
    await page.waitForSelector(PROFILE.selectors.composer, {
      timeout: SIGNED_IN_WAIT_MILLISECONDS,
    });
    return true;
  });

  const isReady = ready;
  if (isReady) return;

  throw new Error(
    `${PROFILE.displayName}: no composer at ${page.url()} — sign in at claude.ai in the bridge Chrome.`,
  );
};

const waitUntilIdle = async (page: Page): Promise<void> => {
  const deadline = Date.now() + IDLE_WAIT_MILLISECONDS;
  while (await isDesignTabBusy(page)) {
    const isDeadlinePassed = Date.now() > deadline;
    if (isDeadlinePassed) {
      throw new Error(`${PROFILE.displayName}: a turn is still running in this project.`);
    }

    const pauseMilliseconds = 1_000;

    await page.waitForTimeout(pauseMilliseconds);
  }
};

const listActiveMessages = async (page: Page) => {
  const pageUrl = page.url();
  const projectId = readProjectIdFromDesignUrl(pageUrl);

  const isProjectIdMissing = projectId == null;
  if (isProjectIdMissing) return [];

  return readActiveDesignMessages(page, projectId);
};

// On home a prompt creates a project; on a project tab it continues the active chat once idle.
const injectPrompt = async (page: Page, prompt: string): Promise<void> => {
  const pageUrl = page.url();

  const isProjectPage = readDesignPageKind(pageUrl) === PROJECT_PAGE_KIND;
  if (isProjectPage) {
    await waitUntilIdle(page);
    const pageUrl = page.url();
    const projectId = readProjectIdFromDesignUrl(pageUrl);

    const hasProjectId = projectId != null;
    if (hasProjectId) await assertDesignProjectIdle(page, projectId);

    const activeMessageCount = (await listActiveMessages(page)).length;
    await typeIntoDesignComposer(page, {
      selector: DESIGN_SELECTORS.chatComposer,
      text: prompt,
      append: false,
    });
    await page.locator(DESIGN_SELECTORS.chatSend).click();
    markDesignTurnStarted(page, activeMessageCount);
    return;
  }

  await typeIntoDesignComposer(page, {
    selector: DESIGN_SELECTORS.homeComposer,
    text: prompt,
    append: false,
  });
  await page.locator(DESIGN_SELECTORS.homeSend).click();
  markDesignTurnStarted(page, 0);
};

const turnTimeoutMilliseconds = (waitSettings: number | ReplyWaitSettings | undefined): number => {
  const isWaitTypeNumber = typeof waitSettings === "number";
  if (isWaitTypeNumber) return waitSettings;

  const timeoutSetting = waitSettings?.timeout;

  const hasWaitSettingsTimeout = timeoutSetting != null;
  if (hasWaitSettingsTimeout) return timeoutSetting;

  const actionTimeoutMilliseconds = 1000;

  return DEFAULT_ASK_TIMEOUT_SECONDS * actionTimeoutMilliseconds;
};

const readTurnMessageCount = async (page: Page): Promise<number> => {
  const messageCountOnPage = readDesignTurnMessageCount(page);

  const isMessageCountOnPage = messageCountOnPage != null;
  if (isMessageCountOnPage) return messageCountOnPage;

  const activeMessages = await listActiveMessages(page);
  return activeMessages.length;
};

const waitForReply = async (
  page: Page,
  waitSettings?: number | ReplyWaitSettings,
): Promise<void> => {
  const timeoutMilliseconds = turnTimeoutMilliseconds(waitSettings);
  await page.waitForURL((url) => readProjectIdFromDesignUrl(url.href) != null, {
    timeout: PROJECT_URL_WAIT_MILLISECONDS,
  });
  const pageUrl = page.url();
  const projectId = readProjectIdFromDesignUrl(pageUrl);

  const isProjectIdMissing = projectId == null;
  if (isProjectIdMissing) throw new Error(`${PROFILE.displayName}: no project opened.`);

  const turnMessageCount = await readTurnMessageCount(page);

  const report = await waitForDesignTurn(page, {
    projectId,
    conversationId: undefined,
    messageCount: turnMessageCount,
    model: undefined,
    autoDecide: false,
    timeoutMilliseconds: timeoutMilliseconds,
  });

  const isStatusRunning = report.status === "running";
  if (isStatusRunning) {
    throw new Error(
      `${PROFILE.displayName}: the turn is still running after ${timeoutMilliseconds} ms.`,
    );
  }

  markDesignTurnSettled(page);
};

const captureLastReply = async (page: Page): Promise<string> => {
  const activeReplies = (await listActiveMessages(page)).filter(
    (message) => message.role === ASSISTANT_ROLE,
  );
  const lastReply = activeReplies.at(-1);

  const isLastReplyMissing = lastReply == null;
  if (isLastReplyMissing) return "";

  return lastReply.content;
};

const countAssistantReplies = async (page: Page): Promise<number> => {
  const messages = await listActiveMessages(page);
  return messages.filter((message) => message.role === ASSISTANT_ROLE).length;
};

const captureAllMessages = async (
  page: Page,
): Promise<Array<{ role: string; content: string }>> => {
  const messages = await listActiveMessages(page);
  return messages.map((message) => ({ role: message.role, content: message.content }));
};

const readSidebarConversations = async (
  page: Page,
): Promise<Array<{ id: string; title: string; url: string }>> => {
  const projects = await listDesignProjects(page, {
    kind: PROJECTS_KEY,
    limit: SIDEBAR_PROJECT_LIMIT,
  });
  return projects.map((project) => ({ id: project.id, title: project.name, url: project.url }));
};

const assertTabIdle = async (page: Page): Promise<void> => {
  const hasBusyDesignTab = await isDesignTabBusy(page);
  if (hasBusyDesignTab) {
    throw new Error(`${PROFILE.displayName}: this tab is running a turn; leave it open.`);
  }
};

const navigateToConversation = async (page: Page, url: string): Promise<void> => {
  const isNotDesignUrlUrl = !isDesignUrl(url);
  if (isNotDesignUrlUrl) throw new Error(`${PROFILE.displayName}: not a Claude Design URL: ${url}`);

  await assertTabIdle(page);
  await page.goto(url, { waitUntil: HTML_PARSED_WAIT });
};

const startNewConversation = async (page: Page): Promise<void> => {
  await assertTabIdle(page);
  const pageUrl = page.url();
  const projectId = readProjectIdFromDesignUrl(pageUrl);

  const isProjectIdMissing = projectId == null;
  if (isProjectIdMissing) {
    await page.goto(PROFILE.defaultUrl, { waitUntil: HTML_PARSED_WAIT });
    return;
  }

  await startNewDesignConversation(page, projectId);
};

const detectCurrentModel = async (page: Page): Promise<string> => {
  const model = await probeOrFallback(undefined, () => readCurrentDesignModel(page));

  const isModelMissing = model == null;
  if (isModelMissing) return PROFILE.defaultModel;

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

  const isModelMissing = model == null;
  if (isModelMissing) return query;

  return model;
};

const rewindLastUserPrompt = async (): Promise<void> => {
  throw new Error(`${PROFILE.displayName}: rewinding the last prompt is not supported.`);
};

// Stops only a turn this process started through the engine (see designTabs.ts).
const stopGenerating = async (page: Page): Promise<boolean> => {
  const hasNoTurnMessages = readDesignTurnMessageCount(page) == null;
  if (hasNoTurnMessages) return false;

  markDesignTurnSettled(page);

  const stop = page.locator(DESIGN_SELECTORS.stop).first();

  const isStopVisible = await probeOrFallback(false, () => stop.isVisible());

  if (isStopVisible) {
    await stop.click();
    return true;
  }

  return false;
};

const attachFilesToPrompt = async (page: Page, paths: string[]): Promise<void> => {
  await attachDesignFiles(page, paths);
};

const isLikelyModelLabel = (label: string): boolean =>
  /^(Fable|Opus|Sonnet|Haiku)\b/iu.test(label.trim());

const projectTitleTimeoutMilliseconds = 1_000;

const readDesignProjectTitle = async (page: Page): Promise<string | undefined> => {
  const projectTitleLocator = page.locator(DESIGN_SELECTORS.projectTitle).first();
  const projectTitleCopy = await probeOrFallback(undefined, () =>
    readVisibleCopy(projectTitleLocator, { timeout: projectTitleTimeoutMilliseconds }),
  );

  return projectTitleCopy?.trim();
};

export const readDesignStatus = async (page: Page): Promise<DesignStatus> => {
  const pageUrl = page.url();
  const kind = readDesignPageKind(pageUrl);
  const designTabs = page
    .context()
    .pages()
    .filter((candidate) => isDesignUrl(candidate.url()));

  const designTabInfos = designTabs.map(async (designTab) => ({
    url: designTab.url(),
    projectId: readProjectIdFromDesignUrl(designTab.url()),
    busy: await isDesignTabBusy(designTab),
  }));
  const [tabs, busy, model, projectTitle] = await Promise.all([
    Promise.all(designTabInfos),
    isDesignTabBusy(page),
    probeOrFallback(undefined, () => readCurrentDesignModel(page)),
    readDesignProjectTitle(page),
  ]);
  let actions: readonly string[] = HOME_ACTIONS;

  const isKindProject = kind === PROJECT_PAGE_KIND;
  if (isKindProject)
    actions = [
      ...HOME_ACTIONS,
      ...([
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
      ] as const),
    ];

  return {
    page: kind,
    url: page.url(),
    projectId: readProjectIdFromDesignUrl(page.url()),
    projectTitle,
    model,
    busy,
    tabs,
    actions,
    manual: [
      "Publish as artifact",
      "Send to Claude Code",
      "PNG, video, PDF and PowerPoint export",
      "Partner app exports (Connect)",
      "Comments",
      "Version restore",
    ] as const,
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
  waitForReply: waitForReply,
  captureLastReply: captureLastReply,
  countAssistantReplies: countAssistantReplies,
  captureAllMessages,
  readSidebarConversations,
  navigateToConversation,
  newConversation: startNewConversation,
  detectCurrentModel,
  listAvailableModels,
  selectModel,
  rewindLastUserPrompt,
  stopGenerating,
  attachFilesToPrompt,
  isLikelyModelLabel,
} satisfies BrowserProvider;
