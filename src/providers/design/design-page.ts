import type { Page } from "playwright";
import { DEFAULT_ASK_TIMEOUT_SECONDS, PROVIDER_SETTINGS } from "@/config";
import type { ModelOption } from "@/domain/connector-types.ts";
import type { BrowserProvider, ReplyWaitSettings } from "@/providers/browser-provider.ts";
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

const PROFILE = PROVIDER_SETTINGS.design;
const SIGNED_IN_WAIT_MS = 30_000;
const IDLE_WAIT_MS = 60_000;
const PROJECT_URL_WAIT_MS = 60_000;
const SIDEBAR_PROJECT_LIMIT = 100;

const DESIGN_PAGE_KINDS = ["home", "project", "other"] as const;
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

const HOME_ACTIONS = ["projects", "catalog", "model", "create", "open"] as const;

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
  if (isNotDesignUrlUrl) return "other";

  const hasProjectId = readProjectIdFromDesignUrl(url) !== undefined;
  if (hasProjectId) return "project";

  return "home";
};

const assertSignedIn = async (page: Page): Promise<void> => {
  const pageUrl = page.url();

  const isNotDesignUrl = !isDesignUrl(pageUrl);
  if (isNotDesignUrl) {
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

  const isProjectIdMissing = projectId === undefined;
  if (isProjectIdMissing) return [];

  return readActiveDesignMessages(page, projectId);
};

// On home a prompt creates a project; on a project tab it continues the active chat once idle.
const injectPrompt = async (page: Page, prompt: string): Promise<void> => {
  const pageUrl = page.url();

  const isProjectPage = readDesignPageKind(pageUrl) === "project";
  if (isProjectPage) {
    await waitUntilIdle(page);
    const pageUrl = page.url();
    const projectId = readProjectIdFromDesignUrl(pageUrl);

    const hasProjectId = projectId !== undefined;
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

const turnTimeoutMs = (waitSettings: number | ReplyWaitSettings | undefined): number => {
  const isWaitTypeNumber = typeof waitSettings === "number";
  if (isWaitTypeNumber) return waitSettings;

  const hasWaitSettingsTimeout = waitSettings?.timeout !== undefined;
  if (hasWaitSettingsTimeout) return waitSettings.timeout;

  const actionTimeoutMilliseconds = 1000;

  return DEFAULT_ASK_TIMEOUT_SECONDS * actionTimeoutMilliseconds;
};

const waitForReply = async (
  page: Page,
  waitSettings?: number | ReplyWaitSettings,
): Promise<void> => {
  const timeoutMs = turnTimeoutMs(waitSettings);
  await page.waitForURL((url) => readProjectIdFromDesignUrl(url.href) !== undefined, {
    timeout: PROJECT_URL_WAIT_MS,
  });
  const pageUrl = page.url();
  const projectId = readProjectIdFromDesignUrl(pageUrl);

  const isProjectIdMissing = projectId === undefined;
  if (isProjectIdMissing) throw new Error(`${PROFILE.displayName}: no project opened.`);

  let turnMessageCount = readDesignTurnMessageCount(page);

  const isMessageCountMissing = turnMessageCount === undefined;
  if (isMessageCountMissing) turnMessageCount = (await listActiveMessages(page)).length;

  const report = await waitForDesignTurn(page, {
    projectId,
    conversationId: undefined,
    messageCount: turnMessageCount,
    model: undefined,
    autoDecide: false,
    timeoutMs,
  });

  const isStatusRunning = report.status === "running";
  if (isStatusRunning) {
    throw new Error(`${PROFILE.displayName}: the turn is still running after ${timeoutMs} ms.`);
  }

  markDesignTurnSettled(page);
};

const captureLastReply = async (page: Page): Promise<string> => {
  const activeReplies = (await listActiveMessages(page)).filter(
    (message) => message.role === "assistant",
  );
  const lastReply = activeReplies.at(-1);

  const isLastReplyMissing = lastReply === undefined;
  if (isLastReplyMissing) return "";

  return lastReply.content;
};

const countAssistantReplies = async (page: Page): Promise<number> => {
  const messages = await listActiveMessages(page);
  return messages.filter((message) => message.role === "assistant").length;
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
    kind: "projects",
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
  await page.goto(url, { waitUntil: "domcontentloaded" });
};

const startNewConversation = async (page: Page): Promise<void> => {
  await assertTabIdle(page);
  const pageUrl = page.url();
  const projectId = readProjectIdFromDesignUrl(pageUrl);

  const isProjectIdMissing = projectId === undefined;
  if (isProjectIdMissing) {
    await page.goto(PROFILE.defaultUrl, { waitUntil: "domcontentloaded" });
    return;
  }

  await startNewDesignConversation(page, projectId);
};

const detectCurrentModel = async (page: Page): Promise<string> => {
  const model = await readCurrentDesignModel(page).catch(() => undefined);

  const isModelMissing = model === undefined;
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

  const isModelMissing = model === undefined;
  if (isModelMissing) return query;

  return model;
};

const rewindLastUserPrompt = async (): Promise<void> => {
  throw new Error(`${PROFILE.displayName}: rewinding the last prompt is not supported.`);
};

// Stops only a turn this process started through the engine (see designTabs.ts).
const stopGenerating = async (page: Page): Promise<boolean> => {
  const hasNoTurnMessages = readDesignTurnMessageCount(page) === undefined;
  if (hasNoTurnMessages) return false;

  markDesignTurnSettled(page);

  const stop = page.locator(DESIGN_SELECTORS.stop).first();
  const stopVisible = await stop.isVisible().catch(() => false);

  const isStopHidden = !stopVisible;
  if (isStopHidden) return false;

  await stop.click();
  return true;
};

const attachFilesToPrompt = async (page: Page, paths: string[]): Promise<void> => {
  await attachDesignFiles(page, paths);
};

const isLikelyModelLabel = (label: string): boolean =>
  /^(Fable|Opus|Sonnet|Haiku)\b/iu.test(label.trim());

export const readDesignStatus = async (page: Page): Promise<DesignStatus> => {
  const pageUrl = page.url();
  const kind = readDesignPageKind(pageUrl);
  const designTabs = page
    .context()
    .pages()
    .filter((candidate) => isDesignUrl(candidate.url()));
  const actionTimeoutMilliseconds = 1_000;

  const designTabInfos = designTabs.map(async (designTab) => ({
    url: designTab.url(),
    projectId: readProjectIdFromDesignUrl(designTab.url()),
    busy: await isDesignTabBusy(designTab),
  }));
  const [tabs, busy, model, projectTitle] = await Promise.all([
    Promise.all(designTabInfos),
    isDesignTabBusy(page),
    readCurrentDesignModel(page).catch(() => undefined),
    page
      .locator(DESIGN_SELECTORS.projectTitle)
      .first()
      .innerText({ timeout: actionTimeoutMilliseconds })
      .then(
        (title) => title.trim(),
        () => undefined,
      ),
  ]);
  let actions: readonly string[] = HOME_ACTIONS;

  const isKindProject = kind === "project";
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
