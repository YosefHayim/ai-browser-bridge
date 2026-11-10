import type { Locator, Page } from "playwright";
import { probeOrFallback } from "@/providers/browser-provider.ts";
import {
  type ChatGptApiReply,
  type ChatGptApiReplyStatus,
  readChatGptApiReplyStatus,
  requestChatGptApi,
} from "./chatgpt-backend-api.ts";
import { searchChatGptConversations } from "./chatgpt-conversation-search.ts";
import { readChatGptConversationIdFromUrl } from "./chatgpt-conversation-url.ts";

const ESCAPE_KEY = "Escape";

const SCROLL_STEP_PIXELS = 800;

const NAV_TAG = "nav";

const SCROLL_SLACK_PIXELS = 20;

const TWO_SECONDS_MILLISECONDS = 2_000;

const HTML_PARSED_WAIT = "domcontentloaded";

const FIVE_SECONDS_MILLISECONDS = 5_000;

const CONVERSATION_LINK_SELECTOR = 'nav a[href*="/c/"]';

const MOUSE_POINTER_TYPE = "mouse";

const POINTER_DOWN_EVENT = "pointerdown";

const EIGHT_HUNDRED_MILLISECONDS = SCROLL_STEP_PIXELS;

const QUARTER_SECOND_MILLISECONDS = 250;

const PATCH_METHOD = "PATCH";

const FAILED_STATUS = "failed";

const RATE_LIMITED_STATUS = "rate-limited";

const OK_STATUS = "ok";

const GET_METHOD = "GET";

const MENU_CHOICE_ROLE = "menuitem";

const FOUR_SECONDS_MILLISECONDS = 4_000;

const ONE_SECOND_MILLISECONDS = 1_000;

const BUTTON_ROLE = "button";

const ATTACHED_WAIT_MODE = "attached";

const TWO_HUNDRED_MILLISECONDS = 200;

const ONE_POINT_TWO_SECONDS_MILLISECONDS = 1_200;

const EIGHT_SECONDS_MILLISECONDS = 8_000;

const VISIBLE_WAIT_MODE = "visible";

const WORKSPACE = {
  projectsUrl: "https://chatgpt.com/projects",
  scheduledUrl: "https://chatgpt.com/scheduled",
  sidebarProjects: '[data-testid="sidebar-item-projects"]',
  newProjectButton: 'button[aria-label="Add new project"]',
  projectNameInput: 'input[name="project-name"]',
  projectFolderIcon: '[data-testid="project-folder-icon"]',
  projectDirectoryRow: "[data-projects-rows] [data-project-row]",
  chatLink: CONVERSATION_LINK_SELECTOR,
  activeConversationMenu:
    '[data-testid="conversation-options-button"], button[aria-label="Chat actions"][aria-haspopup="menu"]',
  menuItem: '[role="menuitem"]',
  sidebarOptionsButton:
    'button[aria-label="Chat actions"], button[aria-label^="Open conversation options"]',
} as const;

export const readProjectNameFromDirectoryString = (string: string): string | null => {
  const [name, detail] = string.split("\n");

  const isNameMissing = name == null;
  if (isNameMissing) return null;

  const projectName = name.trim();

  const isProjectNameEmpty = !projectName;
  if (isProjectNameEmpty) return null;

  const isModifiedDateLine =
    projectName === "Name" && detail != null && detail.trim() === "Modified";
  if (isModifiedDateLine) return null;

  return projectName;
};

const PROJECT_LINES_ORIGIN = String.raw`
(() => {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const folderLines = Array.from(document.querySelectorAll('[data-testid="project-folder-icon"]'))
    .map((icon) => icon.closest('[role="row"], a[href], li'))
    .filter(Boolean);
  const names = [];
  const seen = new Set();
  for (const folderLine of folderLines) {
    const leaf = Array.from(folderLine.querySelectorAll("*")).find(
      (leafCandidate) => leafCandidate.children.length === 0 && clean(leafCandidate.textContent),
    );
    const isLeafFound = leaf != null;
    const name = clean(isLeafFound ? leaf.textContent : folderLine.textContent);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
})()
`;

const SCHEDULED_LINES_ORIGIN = String.raw`
(() => {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const main = document.querySelector('main, [role="main"]') || document.body;
  const chatLines = Array.from(main.querySelectorAll('[role="row"], li, article'));
  const tasks = [];
  const seen = new Set();
  for (const chatLine of chatLines) {
    const title = clean((chatLine.querySelector('[role="gridcell"], h2, h3, a') || chatLine).textContent);
    if (!title || seen.has(title)) continue;
    seen.add(title);
    tasks.push({ title });
  }
  return tasks;
})()
`;

export type WorkspaceProject = {
  name: string;
};

export type RenameProjectVerdict = {
  project: string;
  renamedTo: string;
  renamed: boolean;
  reason?: string;
};

export type DeleteProjectVerdict = {
  project: string;
  deleted: boolean;
  reason?: string;
};

export type MoveChatVerdict = {
  chat: string;
  project: string;
  moved: boolean;
  alreadyFiled?: boolean;
  rateLimited?: boolean;
  reason?: string;
};

export type ArchiveChatVerdict = {
  chat: string;
  archived: boolean;
  reason?: string;
};

export type WorkspaceTask = {
  title: string;
  schedule?: string;
};

export type MoveChatDetails = {
  chat: string;
  project: string;
  projectId: string;
};

export interface RenameChatDetails {
  chat: string;
  title: string;
}

export interface RenamedChat {
  id: string;
  title: string;
}

export const listProjects = async (page: Page): Promise<WorkspaceProject[]> => {
  await ensureOnProjectsPage(page);
  const directoryLines = page.locator(WORKSPACE.projectDirectoryRow);
  await probeOrFallback(null, () =>
    directoryLines.first().waitFor({ timeout: FIVE_SECONDS_MILLISECONDS }),
  );
  const directoryLineStrings = await directoryLines.allInnerTexts();
  const directoryNames = directoryLineStrings
    .map(readProjectNameFromDirectoryString)
    .filter((name): name is string => name != null);

  const hasDirectoryNames = directoryNames.length > 0;
  if (hasDirectoryNames) {
    const uniqueDirectoryNames = new Set(directoryNames);
    return Array.from(uniqueDirectoryNames).map((name) => ({ name }));
  }

  await probeOrFallback(null, () =>
    page
      .locator(WORKSPACE.projectFolderIcon)
      .first()
      .waitFor({ timeout: FIVE_SECONDS_MILLISECONDS }),
  );
  const names = await page.evaluate<string[]>(PROJECT_LINES_ORIGIN);
  return names.map((name) => ({ name }));
};

// Fresh tabs abort goto mid-navigation, so retry once after settle.
const gotoStable = async (page: Page, url: string): Promise<void> => {
  const maxGotoAttempts = 2;
  for (let attempt = 0; attempt < maxGotoAttempts; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: HTML_PARSED_WAIT });
      return;
    } catch (error) {
      const errorString = String(error);
      const interrupted = /interrupted by another navigation/i.test(errorString);

      const isInterruptedOnFirstAttempt = attempt === 0 && interrupted;
      if (isInterruptedOnFirstAttempt) {
        await probeOrFallback(null, () => page.waitForLoadState(HTML_PARSED_WAIT));
        continue;
      }

      throw error;
    }
  }
};

const ensureOnProjectsPage = async (page: Page): Promise<void> => {
  const isOnProjectsPage = page.url().startsWith(WORKSPACE.projectsUrl);
  if (isOnProjectsPage) return;

  await gotoStable(page, WORKSPACE.projectsUrl);
  await page.waitForTimeout(EIGHT_HUNDRED_MILLISECONDS);
};

export const createProject = async (page: Page, name: string): Promise<WorkspaceProject> => {
  const trimmed = name.trim();

  const isTrimmedEmpty = !trimmed;
  if (isTrimmedEmpty) throw new Error("Project name is required.");

  await openNewProjectPanel(page);
  const field = page.locator(WORKSPACE.projectNameInput).first();
  await field.waitFor({ state: VISIBLE_WAIT_MODE, timeout: EIGHT_SECONDS_MILLISECONDS });
  await field.fill(trimmed);
  await submitCreateProject(page);
  await page.waitForTimeout(ONE_POINT_TWO_SECONDS_MILLISECONDS);
  return { name: trimmed };
};

// Overlapping sidebar links intercept coordinate clicks, so dispatch the click on the node.
const openNewProjectPanel = async (page: Page): Promise<void> => {
  await ensureOnProjectsPage(page);
  await probeOrFallback(null, () => page.locator(WORKSPACE.sidebarProjects).first().hover());
  await page.waitForTimeout(TWO_HUNDRED_MILLISECONDS);

  const button = page.locator(WORKSPACE.newProjectButton).first();

  await button.waitFor({ state: ATTACHED_WAIT_MODE, timeout: EIGHT_SECONDS_MILLISECONDS });
  await button.evaluate((navElement) => {
    const isHtmlElement = navElement instanceof HTMLElement;
    if (isHtmlElement) navElement.click();
  });
};

const submitCreateProject = async (page: Page): Promise<void> => {
  const button = page.getByRole(BUTTON_ROLE, { name: /create project/i }).first();

  const isButtonShown = await probeOrFallback(false, () =>
    button.isVisible({ timeout: TWO_SECONDS_MILLISECONDS }),
  );
  if (isButtonShown) {
    await button.click();
    return;
  }

  await page.locator(WORKSPACE.projectNameInput).first().press("Enter");
};

// Opens on dispatched pointerdown rather than a coordinate click.
const openProjectMenu = async (page: Page, project: string): Promise<boolean> => {
  const trigger = page
    .getByRole(BUTTON_ROLE, { name: `Project actions for ${project}`, exact: true })
    .first();

  const maxProjectActionsAttempts = 2;
  for (let attempt = 0; attempt < maxProjectActionsAttempts; attempt += 1) {
    const isFirstAttempt = attempt === 0;
    if (isFirstAttempt) await ensureOnProjectsPage(page);
    else {
      await gotoStable(page, WORKSPACE.projectsUrl);
      await page.waitForTimeout(ONE_SECOND_MILLISECONDS);
    }

    const isAttached = await isLocatorWaitMet(trigger, {
      state: ATTACHED_WAIT_MODE,
      timeout: FIVE_SECONDS_MILLISECONDS,
    });

    const isNotAttached = !isAttached;
    if (isNotAttached) continue;

    const isMenuShown = await probeOrFallback(false, async () => {
      await probeOrFallback(null, () => trigger.scrollIntoViewIfNeeded());
      await probeOrFallback(null, () =>
        trigger.dispatchEvent(
          POINTER_DOWN_EVENT,
          {
            button: 0,
            isPrimary: true,
            pointerType: MOUSE_POINTER_TYPE,
          },
          { timeout: TWO_SECONDS_MILLISECONDS },
        ),
      );
      await page
        .locator(WORKSPACE.menuItem)
        .first()
        .waitFor({ timeout: FOUR_SECONDS_MILLISECONDS });
      return true;
    });
    if (isMenuShown) return true;

    await dismissMenu(page);
  }
  return false;
};

const isLocatorWaitMet = async (
  locator: Locator,
  waitSettings: { state: "attached" | "visible"; timeout: number },
): Promise<boolean> => {
  return probeOrFallback(false, async () => {
    await locator.waitFor(waitSettings);
    return true;
  });
};

// The project menu renders after its trigger fires; wait for the item instead of sampling once.
const isMenuElementShown = (
  element: Locator,
  timeout = FOUR_SECONDS_MILLISECONDS,
): Promise<boolean> => {
  return isLocatorWaitMet(element, { state: VISIBLE_WAIT_MODE, timeout });
};

export const renameProject = async (
  page: Page,
  details: { project: string; name: string },
): Promise<RenameProjectVerdict> => {
  const base: RenameProjectVerdict = {
    project: details.project,
    renamedTo: details.name.trim(),
    renamed: false,
  };

  const isBaseRenamedToEmpty = !base.renamedTo;
  if (isBaseRenamedToEmpty) return { ...base, reason: "a new name is required" };

  const field = page.locator('input[aria-label="Project name"]').first();
  let opened = false;

  const maxRenameOpenAttempts = 3;
  for (let attempt = 0; attempt < maxRenameOpenAttempts && !opened; attempt += 1) {
    const isRetryAttempt = attempt > 0;
    if (isRetryAttempt) await dismissMenu(page);

    const didProjectMenuOpen = await openProjectMenu(page, details.project);

    const isProjectMenuNotOpened = !didProjectMenuOpen;
    if (isProjectMenuNotOpened) {
      return { ...base, reason: `project "${details.project}" not found` };
    }

    const settings = page.getByRole(MENU_CHOICE_ROLE, { name: "Project settings" }).first();

    const settingsShown = await isMenuElementShown(settings);

    const isNotSettingsShown = !settingsShown;
    if (isNotSettingsShown) continue;

    await probeOrFallback(null, () => settings.click());
    const threeAndAHalfSecondsMilliseconds = 3_500;

    opened = await probeOrFallback(false, () =>
      field.isVisible({ timeout: threeAndAHalfSecondsMilliseconds }),
    );
  }

  const isNotOpened = !opened;
  if (isNotOpened) {
    await dismissMenu(page);
    return { ...base, reason: "the project name field did not open" };
  }

  // Real keystrokes so React's controlled input registers the change.
  await field.click();
  await field.press("ControlOrMeta+a");
  const renameTypingDelayMilliseconds = 15;

  await field.pressSequentially(base.renamedTo, { delay: renameTypingDelayMilliseconds });

  const save = page.getByRole(BUTTON_ROLE, { name: "Save", exact: true }).first();
  const twoAndAHalfSecondsMilliseconds = 2_500;

  const saveVisible = await probeOrFallback(false, () =>
    save.isVisible({ timeout: twoAndAHalfSecondsMilliseconds }),
  );

  const isSaveHidden = !saveVisible;
  if (isSaveHidden) {
    await dismissMenu(page);
    return { ...base, reason: "the Save button did not appear after editing the name" };
  }

  await save.click();
  await page.waitForTimeout(ONE_POINT_TWO_SECONDS_MILLISECONDS);
  return { ...base, renamed: true };
};

export const deleteProject = async (page: Page, project: string): Promise<DeleteProjectVerdict> => {
  const base: DeleteProjectVerdict = { project, deleted: false };
  const confirm = page
    .getByRole("dialog")
    .getByRole(BUTTON_ROLE, { name: /^Delete/ })
    .first();
  let confirmVisible = false;

  const maxRenameConfirmAttempts = 3;
  for (let attempt = 0; attempt < maxRenameConfirmAttempts && !confirmVisible; attempt += 1) {
    const isRetryAttempt = attempt > 0;
    if (isRetryAttempt) await dismissMenu(page);

    const didProjectMenuOpen = await openProjectMenu(page, project);

    const isProjectMenuStillClosed = !didProjectMenuOpen;
    if (isProjectMenuStillClosed) {
      return { ...base, reason: `project "${project}" not found` };
    }

    const del = page.getByRole(MENU_CHOICE_ROLE, { name: "Delete project" }).first();

    const deleteShown = await isMenuElementShown(del);

    const isNotDeleteShown = !deleteShown;
    if (isNotDeleteShown) continue;

    await probeOrFallback(null, () => del.click());
    confirmVisible = await isMenuElementShown(confirm, FIVE_SECONDS_MILLISECONDS);
  }

  const isNotConfirmVisible = !confirmVisible;
  if (isNotConfirmVisible) {
    await dismissMenu(page);
    return { ...base, reason: "the delete confirmation did not appear" };
  }

  await confirm.click();
  await page.waitForTimeout(ONE_SECOND_MILLISECONDS);
  return { ...base, deleted: true };
};

interface ConversationApiRead {
  state: ChatGptApiReplyStatus;
  status: number;
  conversationTemplateId: string | null;
}

const readConversationApiPath = (conversationId: string): string =>
  `/backend-api/conversation/${encodeURIComponent(conversationId)}`;

const markMoveRateLimited = (base: MoveChatVerdict): MoveChatVerdict => ({
  ...base,
  rateLimited: true,
  reason: "ChatGPT rate limit (HTTP 429)",
});

const readConversationApi = async (
  page: Page,
  conversationId: string,
): Promise<ConversationApiRead> => {
  const replyApiPath = readConversationApiPath(conversationId);
  const reply = await requestChatGptApi(page, {
    method: GET_METHOD,
    apiPath: replyApiPath,
  });
  const replyStatus = readChatGptApiReplyStatus(reply.status);

  const isNotReadOk = replyStatus !== OK_STATUS;
  if (isNotReadOk)
    return { state: replyStatus, status: reply.status, conversationTemplateId: null };

  const conversation = JSON.parse(reply.bodyText);
  return {
    state: replyStatus,
    status: reply.status,
    conversationTemplateId: conversation.conversation_template_id,
  };
};

const findConversationIdForChat = async (page: Page, chat: string): Promise<string | null> => {
  const conversationId = stripConversationId(chat);

  const isIdentifier = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(conversationId);
  if (isIdentifier) return conversationId;

  const searchLimit = SCROLL_SLACK_PIXELS;

  const reports = await searchChatGptConversations(page, { query: chat, limit: searchLimit });
  const exactReport = reports.find((report) => report.title.trim() === chat.trim());
  return exactReport?.id ?? null;
};

// A 429 is reported as rateLimited so the queue defers the item without spending an attempt.
export const moveChatToProject = async (
  page: Page,
  details: MoveChatDetails,
): Promise<MoveChatVerdict> => {
  const base: MoveChatVerdict = { chat: details.chat, project: details.project, moved: false };
  const conversationId = await findConversationIdForChat(page, details.chat);

  const isChatMissing = conversationId == null;
  if (isChatMissing) return { ...base, reason: `no chat titled "${details.chat}"` };

  const before = await readConversationApi(page, conversationId);

  const isBeforeRateLimited = before.state === RATE_LIMITED_STATUS;
  if (isBeforeRateLimited) return markMoveRateLimited(base);

  const isBeforeFailed = before.state === FAILED_STATUS;

  if (isBeforeFailed) {
    return { ...base, reason: `ChatGPT returned HTTP ${before.status} for the chat` };
  }

  const isAlreadyFiled = before.conversationTemplateId === details.projectId;
  if (isAlreadyFiled) {
    return { ...base, alreadyFiled: true, reason: `already in project "${details.project}"` };
  }

  const moveApiPath = readConversationApiPath(conversationId);
  const moveReply = await requestChatGptApi(page, {
    method: PATCH_METHOD,
    apiPath: moveApiPath,
    body: { gizmo_id: details.projectId },
  });

  const moveStatus = readChatGptApiReplyStatus(moveReply.status);

  const isMoveRateLimited = moveStatus === RATE_LIMITED_STATUS;
  if (isMoveRateLimited) return markMoveRateLimited(base);

  const isMoveFailed = moveStatus === FAILED_STATUS;
  if (isMoveFailed) {
    return {
      ...base,
      reason: `ChatGPT rejected the move into project "${details.project}" (HTTP ${moveReply.status})`,
    };
  }

  const after = await readConversationApi(page, conversationId);

  const isAfterRateLimited = after.state === RATE_LIMITED_STATUS;
  if (isAfterRateLimited) return markMoveRateLimited(base);

  const isNotMoveConfirmed = after.conversationTemplateId !== details.projectId;
  if (isNotMoveConfirmed) {
    return {
      ...base,
      reason: `ChatGPT did not confirm the move into project "${details.project}"`,
    };
  }

  return { ...base, moved: true };
};

const requireChatGptReplyOk = (reply: ChatGptApiReply, action: string): void => {
  const replyStatus = readChatGptApiReplyStatus(reply.status);

  const isReplyOk = replyStatus === OK_STATUS;
  if (isReplyOk) return;

  const isRateLimited = replyStatus === RATE_LIMITED_STATUS;
  if (isRateLimited) {
    throw new Error(`ChatGPT rate-limited the chat ${action} (HTTP 429). Resume later.`);
  }

  throw new Error(`ChatGPT chat ${action} failed with HTTP ${reply.status}.`);
};

export const renameChat = async (page: Page, details: RenameChatDetails): Promise<RenamedChat> => {
  const conversationId = await findConversationIdForChat(page, details.chat);

  const isChatMissing = conversationId == null;
  if (isChatMissing) throw new Error(`no chat titled "${details.chat}"`);

  const renameApiPath = readConversationApiPath(conversationId);
  const renameReply = await requestChatGptApi(page, {
    method: PATCH_METHOD,
    apiPath: renameApiPath,
    body: { title: details.title },
  });
  requireChatGptReplyOk(renameReply, "rename");

  const confirmApiPath = readConversationApiPath(conversationId);
  const confirmReply = await requestChatGptApi(page, {
    method: GET_METHOD,
    apiPath: confirmApiPath,
  });
  requireChatGptReplyOk(confirmReply, "rename check");
  const conversation = JSON.parse(confirmReply.bodyText);

  const isNotTitleConfirmed = conversation.title !== details.title;
  if (isNotTitleConfirmed) {
    throw new Error(`ChatGPT did not confirm the new title for chat ${conversationId}.`);
  }

  return { id: conversationId, title: details.title };
};

export const archiveChat = async (page: Page, chat: string): Promise<ArchiveChatVerdict> => {
  const base: ArchiveChatVerdict = { chat, archived: false };

  const didConversationMenuOpen = await openConversationMenu(page, chat);

  const isConversationMenuNotOpened = !didConversationMenuOpen;
  if (isConversationMenuNotOpened) {
    return { ...base, reason: "could not open the chat ⋯ menu" };
  }

  const archiveElement = page
    .locator(`${WORKSPACE.menuItem}:visible`)
    .filter({ hasText: /^archive$/i })
    .first();
  const archiveElementVisible = await probeOrFallback(false, () =>
    archiveElement.isVisible({ timeout: TWO_SECONDS_MILLISECONDS }),
  );

  const isArchiveElementHidden = !archiveElementVisible;
  if (isArchiveElementHidden) {
    await dismissMenu(page);
    return { ...base, reason: "no 'Archive' option for this chat" };
  }

  await archiveElement.click();
  const pauseAfterArchiveClickMilliseconds = 600;

  await page.waitForTimeout(pauseAfterArchiveClickMilliseconds);
  return { ...base, archived: true };
};

// Sidebar is virtualized: open the conversation so its active row mounts, then scroll.
const findChatLine = async (page: Page, chat: string): Promise<Locator | null> => {
  const id = stripConversationId(chat);
  const byHref = page.locator(`nav a[href*="/c/${id}"]`).first();
  const byTitle = page.locator(WORKSPACE.chatLink, { hasText: chat }).first();

  const byHrefCount = await byHref.count();

  const hasHrefHit = byHrefCount > 0;
  if (hasHrefHit) return byHref;

  const looksLikeId = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id);

  const isIdMissingFromUrl = looksLikeId && !page.url().includes(`/c/${id}`);
  if (isIdMissingFromUrl) {
    await gotoStable(page, `https://chatgpt.com/c/${id}`);

    const hasHrefHitAfterWait = (await byHref.count()) > 0;
    if (hasHrefHitAfterWait) return byHref;

    const isConversationMenuActive = await waitForActiveConversationMenu(page, id);
    if (isConversationMenuActive) return null;
  }

  const byTitleCount = await byTitle.count();

  const hasTitleHit = byTitleCount > 0;
  if (hasTitleHit) return byTitle;

  const isConversationMenuOpenById = looksLikeId && (await waitForActiveConversationMenu(page, id));
  if (isConversationMenuOpenById) return null;

  // Reset to top: a prior multi-chat op can leave the list scrolled mid-history.
  await page.evaluate(() => {
    const findScrollableNav = (start: Element | null): Element | null => {
      const isNavFound =
        start == null || start.scrollHeight > start.clientHeight + SCROLL_SLACK_PIXELS;
      if (isNavFound) return start;

      return findScrollableNav(start.parentElement);
    };
    const anchor = document.querySelector(CONVERSATION_LINK_SELECTOR);
    const isAnchorFound = anchor != null;
    const startNav = isAnchorFound ? anchor.closest(NAV_TAG) : document.querySelector(NAV_TAG);
    const navElement = findScrollableNav(startNav);

    const hasNavElement = navElement != null;
    if (hasNavElement) {
      navElement.scrollTo(0, 0);
      return;
    }

    document.scrollingElement?.scrollTo(0, 0);
  });
  await page.waitForTimeout(QUARTER_SECOND_MILLISECONDS);
  // Stop only once the rendered-link count stops growing, not after one no-op scroll.
  let previousCount = -1;
  let stable = 0;
  const stableCountNeeded = 4;

  const maxScrollSteps = 80;

  for (let i = 0; i < maxScrollSteps && stable < stableCountNeeded; i += 1) {
    const hasHrefLine = (await byHref.count()) > 0;
    if (hasHrefLine) return byHref;

    const hasTitleLine = (await byTitle.count()) > 0;
    if (hasTitleLine) return byTitle;

    await page.evaluate(() => {
      const findScrollableNav = (start: Element | null): Element | null => {
        const isNavFound =
          start == null || start.scrollHeight > start.clientHeight + SCROLL_SLACK_PIXELS;
        if (isNavFound) return start;

        return findScrollableNav(start.parentElement);
      };
      const anchor = document.querySelector(CONVERSATION_LINK_SELECTOR);
      const isAnchorFound = anchor != null;
      const startNav = isAnchorFound ? anchor.closest(NAV_TAG) : document.querySelector(NAV_TAG);
      const navElement = findScrollableNav(startNav);

      const hasNavElement = navElement != null;
      if (hasNavElement) {
        navElement.scrollBy(0, SCROLL_STEP_PIXELS);
        return;
      }

      document.scrollingElement?.scrollBy(0, SCROLL_STEP_PIXELS);
    });
    const scrollSettleMilliseconds = 220;

    await page.waitForTimeout(scrollSettleMilliseconds);

    const count = await page.locator(WORKSPACE.chatLink).count();

    const isCountUnchanged = count === previousCount;
    if (isCountUnchanged) {
      stable += 1;
    } else {
      stable = 0;
    }

    previousCount = count;
  }
  return null;
};

// A sticky header intercepts coordinate clicks, so dispatch pointerdown on the element.
const openChatMenu = async (page: Page, line: Locator): Promise<boolean> => {
  const lineWithSettings = line.locator(
    `xpath=ancestor-or-self::*[.//button[${'@aria-label="Chat actions" or starts-with(@aria-label, "Open conversation options")'}]][1]`,
  );
  const lineWithSettingsCount = await lineWithSettings.count();
  const hasLineWithSettings = lineWithSettingsCount > 0;
  const scope = hasLineWithSettings ? lineWithSettings : line;
  await probeOrFallback(null, () => scope.hover());
  await page.waitForTimeout(TWO_HUNDRED_MILLISECONDS);
  const settingsButton = scope.locator(WORKSPACE.sidebarOptionsButton).first();

  const settingsButtonCount = await settingsButton.count();

  const isSettingsButtonMissing = settingsButtonCount === 0;
  if (isSettingsButtonMissing) return false;

  return probeOrFallback(false, async () => {
    await settingsButton.dispatchEvent(POINTER_DOWN_EVENT, {
      button: 0,
      isPrimary: true,
      pointerType: MOUSE_POINTER_TYPE,
    });
    await page
      .locator(`${WORKSPACE.menuItem}:visible`)
      .first()
      .waitFor({ timeout: FOUR_SECONDS_MILLISECONDS });
    return true;
  });
};

const openConversationMenu = async (page: Page, chat: string): Promise<boolean> => {
  let targetConversationId = stripConversationId(chat);

  const targetLooksLikeId = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(targetConversationId);
  const openPageUrl = page.url();

  const isTargetConversationOpen =
    targetLooksLikeId &&
    readChatGptConversationIdFromUrl(openPageUrl) === targetConversationId &&
    (await openActiveConversationMenu(page, targetConversationId));
  if (isTargetConversationOpen) {
    return true;
  }

  const line = await findChatLine(page, chat);

  const isChatLineFound = line != null;
  if (isChatLineFound) {
    const isSidebarMenuOpen = await openChatMenu(page, line);

    const shouldTryHeaderMenu = !isSidebarMenuOpen && targetLooksLikeId;

    const isHeaderMenuSkipped = !shouldTryHeaderMenu;
    if (isHeaderMenuSkipped) return isSidebarMenuOpen;

    await gotoStable(page, `https://chatgpt.com/c/${targetConversationId}`);
    return openActiveConversationMenu(page, targetConversationId);
  }

  const isNotTargetLooksLikeId = !targetLooksLikeId;
  if (isNotTargetLooksLikeId) {
    const searchLimit = SCROLL_SLACK_PIXELS;

    const reports = await searchChatGptConversations(page, {
      query: chat,
      limit: searchLimit,
    });

    const exactReport = reports.find((report) => report.title.trim() === chat.trim());

    const isExactMissing = exactReport == null;
    if (isExactMissing) return false;

    targetConversationId = exactReport.id;
    await gotoStable(page, exactReport.url);
  }

  return openActiveConversationMenu(page, targetConversationId);
};

const openActiveConversationMenu = async (
  page: Page,
  targetConversationId: string,
): Promise<boolean> => {
  const isActiveConversationMenuShown = await waitForActiveConversationMenu(
    page,
    targetConversationId,
  );

  const isConversationMenuStillClosed = !isActiveConversationMenuShown;
  if (isConversationMenuStillClosed) return false;

  const trigger = page.locator(WORKSPACE.activeConversationMenu).first();

  const maxMenuOpenAttempts = 2;
  for (let attempt = 0; attempt < maxMenuOpenAttempts; attempt += 1) {
    const isFirstAttempt = attempt === 0;
    if (isFirstAttempt) await probeOrFallback(null, () => trigger.click());
    else {
      await dismissMenu(page);
      await probeOrFallback(null, () =>
        trigger.dispatchEvent(
          POINTER_DOWN_EVENT,
          {
            button: 0,
            isPrimary: true,
            pointerType: MOUSE_POINTER_TYPE,
          },
          { timeout: TWO_SECONDS_MILLISECONDS },
        ),
      );
    }

    const isMenuVisible = await probeOrFallback(false, async () => {
      await page
        .locator(`${WORKSPACE.menuItem}:visible`)
        .first()
        .waitFor({ state: VISIBLE_WAIT_MODE, timeout: FOUR_SECONDS_MILLISECONDS });
      return true;
    });

    if (isMenuVisible) return true;
  }
  return false;
};

const waitForActiveConversationMenu = async (
  page: Page,
  conversationId: string,
): Promise<boolean> => {
  const trigger = page.locator(WORKSPACE.activeConversationMenu).first();
  const maxActiveConversationAttempts = SCROLL_SLACK_PIXELS;

  for (let attempt = 0; attempt < maxActiveConversationAttempts; attempt += 1) {
    const activePageUrl = page.url();
    const activeConversationId = readChatGptConversationIdFromUrl(activePageUrl);

    const isConversationActive = activeConversationId === conversationId;
    if (isConversationActive) {
      // ChatGPT can update the project-scoped URL before mounting the header controls.
      const isTriggerShown = await probeOrFallback(false, async () => {
        const menuVisibleTimeoutMilliseconds = 500;

        await trigger.waitFor({
          state: VISIBLE_WAIT_MODE,
          timeout: menuVisibleTimeoutMilliseconds,
        });
        return true;
      });
      if (isTriggerShown) return true;
    }

    await page.waitForTimeout(QUARTER_SECOND_MILLISECONDS);
  }
  return false;
};

// The label appears a moment after the menu opens, so poll for it.
// ChatGPT saves a move a moment after the click, and a reload too early cancels it.
const dismissMenu = async (page: Page): Promise<void> => {
  await probeOrFallback(null, () => page.keyboard.press(ESCAPE_KEY));
  await probeOrFallback(null, () => page.keyboard.press(ESCAPE_KEY));
};

export const listTasks = async (page: Page): Promise<WorkspaceTask[]> => {
  const isNotScheduledPage = !page.url().startsWith(WORKSPACE.scheduledUrl);
  if (isNotScheduledPage) {
    await gotoStable(page, WORKSPACE.scheduledUrl);
    await page.waitForTimeout(ONE_POINT_TWO_SECONDS_MILLISECONDS);
  }

  return page.evaluate<WorkspaceTask[]>(SCHEDULED_LINES_ORIGIN);
};

export const stripConversationId = (idOrUrl: string): string => {
  const conversationId = readChatGptConversationIdFromUrl(idOrUrl);

  const isConversationIdMissing = conversationId == null;
  if (isConversationIdMissing) return idOrUrl;

  return conversationId;
};
