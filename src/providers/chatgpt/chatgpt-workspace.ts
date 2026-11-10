import type { Locator, Page } from "playwright";
import {
  type ChatGptApiReply,
  type ChatGptApiReplyState,
  readChatGptApiReplyStateFrom,
  requestChatGptApi,
} from "./chatgpt-backend-api.ts";
import { searchChatGptConversations } from "./chatgpt-conversation-search.ts";
import { readChatGptConversationIdFromUrl } from "./chatgpt-conversation-url.ts";

// ChatGPT-only workspace ops (Projects, chat→project moves, Scheduled tasks). Not on
// BrowserProvider — Gemini has no equivalent. Selectors from live DOM capture
// (scripts/dev/captureChatgptSelectors.mjs); prefer stable data-testids.

const WORKSPACE = {
  projectsUrl: "https://chatgpt.com/projects",
  scheduledUrl: "https://chatgpt.com/scheduled",
  sidebarProjects: '[data-testid="sidebar-item-projects"]',
  newProjectButton: 'button[aria-label="Add new project"]',
  projectNameInput: 'input[name="project-name"]',
  projectFolderIcon: '[data-testid="project-folder-icon"]',
  projectDirectoryRow: "[data-projects-rows] [data-project-row]",
  chatLink: 'nav a[href*="/c/"]',
  activeConversationMenu:
    '[data-testid="conversation-options-button"], button[aria-label="Chat actions"][aria-haspopup="menu"]',
  menuItem: '[role="menuitem"]',
  sidebarOptionsButton:
    'button[aria-label="Chat actions"], button[aria-label^="Open conversation options"]',
} as const;

const SIDEBAR_OPTIONS_BUTTON_XPATH =
  '@aria-label="Chat actions" or starts-with(@aria-label, "Open conversation options")';

export const readProjectNameFromDirectoryRowText = (text: string): string | null => {
  const [name, detail] = text.split("\n");

  const isNameMissing = name === undefined;
  if (isNameMissing) return null;

  const projectName = name.trim();
  const isProjectNameEmpty = !projectName;
  if (isProjectNameEmpty) return null;

  const isModifiedDateRow =
    projectName === "Name" && detail !== undefined && detail.trim() === "Modified";
  if (isModifiedDateRow) return null;

  return projectName;
};

// Project name is the first text-bearing leaf in the row; date columns follow it.
const PROJECT_ROWS_SOURCE = String.raw`
(() => {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const rows = Array.from(document.querySelectorAll('[data-testid="project-folder-icon"]'))
    .map((icon) => icon.closest('[role="row"], a[href], li'))
    .filter(Boolean);
  const names = [];
  const seen = new Set();
  for (const row of rows) {
    const leaf = Array.from(row.querySelectorAll("*")).find(
      (el) => el.children.length === 0 && clean(el.textContent),
    );
    const name = clean(leaf ? leaf.textContent : row.textContent);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
})()
`;

const SCHEDULED_ROWS_SOURCE = String.raw`
(() => {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const main = document.querySelector('main, [role="main"]') || document.body;
  const rows = Array.from(main.querySelectorAll('[role="row"], li, article'));
  const tasks = [];
  const seen = new Set();
  for (const row of rows) {
    const title = clean((row.querySelector('[role="gridcell"], h2, h3, a') || row).textContent);
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

export type RenameProjectOutcome = {
  project: string;
  renamedTo: string;
  renamed: boolean;
  reason?: string;
};

export type DeleteProjectOutcome = {
  project: string;
  deleted: boolean;
  reason?: string;
};

export type MoveChatOutcome = {
  chat: string;
  project: string;
  moved: boolean;
  alreadyFiled?: boolean;
  rateLimited?: boolean;
  reason?: string;
};

export type ArchiveChatOutcome = {
  chat: string;
  archived: boolean;
  reason?: string;
};

export type WorkspaceTask = {
  title: string;
  schedule?: string;
};

// chat: conversation id (`/c/<id>`) or exact sidebar title. projectId: the Project's `g-p-…` id.
export type MoveChatInput = {
  chat: string;
  project: string;
  projectId: string;
};

export interface RenameChatInput {
  chat: string;
  title: string;
}

export interface RenamedChat {
  id: string;
  title: string;
}

export const listProjects = async (page: Page): Promise<WorkspaceProject[]> => {
  await ensureOnProjectsPage(page);
  const directoryRows = page.locator(WORKSPACE.projectDirectoryRow);
  await directoryRows
    .first()
    .waitFor({ timeout: 5_000 })
    .catch(() => {});
  const directoryRowsTexts = await directoryRows.allInnerTexts();
  const directoryNames = directoryRowsTexts
    .map(readProjectNameFromDirectoryRowText)
    .filter((name): name is string => name !== null);

  const hasDirectoryNames = directoryNames.length > 0;
  if (hasDirectoryNames) {
    return Array.from(new Set(directoryNames)).map((name) => ({ name }));
  }

  await page
    .locator(WORKSPACE.projectFolderIcon)
    .first()
    .waitFor({ timeout: 5_000 })
    .catch(() => {});
  const names = await page.evaluate<string[]>(PROJECT_ROWS_SOURCE);
  return names.map((name) => ({ name }));
};

// Fresh tabs abort goto while their own initial navigation is still in flight
// (Playwright: "interrupted by another navigation"). Retry once after settle.
const gotoStable = async (page: Page, url: string): Promise<void> => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      return;
    } catch (error) {
      const interrupted = /interrupted by another navigation/i.test(String(error));
      const isInterruptedOnFirstAttempt = attempt === 0 && interrupted;
      if (isInterruptedOnFirstAttempt) {
        await page.waitForLoadState("domcontentloaded").catch(() => {});
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
  await page.waitForTimeout(800);
};

export const createProject = async (page: Page, name: string): Promise<WorkspaceProject> => {
  const trimmed = name.trim();
  const isTrimmedEmpty = !trimmed;
  if (isTrimmedEmpty) throw new Error("Project name is required.");

  await openNewProjectPanel(page);
  const field = page.locator(WORKSPACE.projectNameInput).first();
  await field.waitFor({ state: "visible", timeout: 8_000 });
  await field.fill(trimmed);
  await submitCreateProject(page);
  await page.waitForTimeout(1_200);
  return { name: trimmed };
};

// "New project" is a tiny hover-revealed control; overlapping sidebar links intercept
// coordinate clicks (even force). Dispatch click on the node itself.
const openNewProjectPanel = async (page: Page): Promise<void> => {
  await ensureOnProjectsPage(page);
  await page
    .locator(WORKSPACE.sidebarProjects)
    .first()
    .hover()
    .catch(() => {});
  await page.waitForTimeout(200);
  const button = page.locator(WORKSPACE.newProjectButton).first();
  await button.waitFor({ state: "attached", timeout: 8_000 });
  await button.evaluate((el) => {
    const isHtmlElement = el instanceof HTMLElement;
    if (isHtmlElement) el.click();
  });
};

const submitCreateProject = async (page: Page): Promise<void> => {
  const button = page.getByRole("button", { name: /create project/i }).first();
  const isButtonShown = await button.isVisible({ timeout: 2_000 }).catch(() => false);
  if (isButtonShown) {
    await button.click();
    return;
  }

  await page.locator(WORKSPACE.projectNameInput).first().press("Enter");
};

// Opens on dispatched pointerdown rather than a coordinate click.
const openProjectMenu = async (page: Page, project: string): Promise<boolean> => {
  const trigger = page
    .getByRole("button", { name: `Project actions for ${project}`, exact: true })
    .first();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const isFirstAttempt = attempt === 0;
    if (isFirstAttempt) await ensureOnProjectsPage(page);
    else {
      await gotoStable(page, WORKSPACE.projectsUrl);
      await page.waitForTimeout(1_000);
    }

    const isAttached = await isLocatorWaitMet(trigger, { state: "attached", timeout: 5_000 });
    const isNotAttached = !isAttached;
    if (isNotAttached) continue;

    try {
      await trigger.scrollIntoViewIfNeeded().catch(() => {});
      await trigger
        .dispatchEvent(
          "pointerdown",
          {
            button: 0,
            isPrimary: true,
            pointerType: "mouse",
          },
          { timeout: 2_000 },
        )
        .catch(() => {});
      await page.locator(WORKSPACE.menuItem).first().waitFor({ timeout: 4_000 });
      return true;
    } catch {
      await dismissMenu(page);
    }
  }
  return false;
};

const isLocatorWaitMet = async (
  locator: Locator,
  waitOptions: { state: "attached" | "visible"; timeout: number },
): Promise<boolean> => {
  try {
    await locator.waitFor(waitOptions);
    return true;
  } catch {
    return false;
  }
};

// The project menu renders after its trigger fires; wait for the item instead of sampling once.
const isMenuItemShown = (item: Locator, timeout = 4_000): Promise<boolean> => {
  return isLocatorWaitMet(item, { state: "visible", timeout });
};

// Rename via ⋯ → Project settings. Editing the name reveals Save (Close/Cancel discards).
// Reports skips; never throws.
export const renameProject = async (
  page: Page,
  input: { project: string; name: string },
): Promise<RenameProjectOutcome> => {
  const base: RenameProjectOutcome = {
    project: input.project,
    renamedTo: input.name.trim(),
    renamed: false,
  };

  const isBaseRenamedToEmpty = !base.renamedTo;
  if (isBaseRenamedToEmpty) return { ...base, reason: "a new name is required" };

  const field = page.locator('input[aria-label="Project name"]').first();
  let opened = false;
  for (let attempt = 0; attempt < 3 && !opened; attempt += 1) {
    const isRetryAttempt = attempt > 0;
    if (isRetryAttempt) await dismissMenu(page);

    const isProjectMenuNotOpened = !(await openProjectMenu(page, input.project));
    if (isProjectMenuNotOpened) {
      return { ...base, reason: `project "${input.project}" not found` };
    }

    const settings = page.getByRole("menuitem", { name: "Project settings" }).first();

    const settingsShown = await isMenuItemShown(settings);
    const isNotSettingsShown = !settingsShown;
    if (isNotSettingsShown) continue;

    await settings.click().catch(() => {});
    opened = await field.isVisible({ timeout: 3_500 }).catch(() => false);
  }

  const isNotOpened = !opened;
  if (isNotOpened) {
    await dismissMenu(page);
    return { ...base, reason: "the project name field did not open" };
  }

  // Real keystrokes so React's controlled input registers the change.
  await field.click();
  await field.press("ControlOrMeta+a");
  await field.pressSequentially(base.renamedTo, { delay: 15 });

  const save = page.getByRole("button", { name: "Save", exact: true }).first();
  const saveVisible = await save.isVisible({ timeout: 2_500 }).catch(() => false);
  const isSaveHidden = !saveVisible;
  if (isSaveHidden) {
    await dismissMenu(page);
    return { ...base, reason: "the Save button did not appear after editing the name" };
  }

  await save.click();
  await page.waitForTimeout(1_200);
  return { ...base, renamed: true };
};

// Permanently deletes project chats — callers gate with --yes. Reports skips; never throws.
export const deleteProject = async (page: Page, project: string): Promise<DeleteProjectOutcome> => {
  const base: DeleteProjectOutcome = { project, deleted: false };
  const confirm = page
    .getByRole("dialog")
    .getByRole("button", { name: /^Delete/ })
    .first();
  let confirmVisible = false;
  for (let attempt = 0; attempt < 3 && !confirmVisible; attempt += 1) {
    const isRetryAttempt = attempt > 0;
    if (isRetryAttempt) await dismissMenu(page);

    const isProjectMenuStillClosed = !(await openProjectMenu(page, project));
    if (isProjectMenuStillClosed) {
      return { ...base, reason: `project "${project}" not found` };
    }

    const del = page.getByRole("menuitem", { name: "Delete project" }).first();

    const deleteShown = await isMenuItemShown(del);
    const isNotDeleteShown = !deleteShown;
    if (isNotDeleteShown) continue;

    await del.click().catch(() => {});
    confirmVisible = await isMenuItemShown(confirm, 5_000);
  }

  const isNotConfirmVisible = !confirmVisible;
  if (isNotConfirmVisible) {
    await dismissMenu(page);
    return { ...base, reason: "the delete confirmation did not appear" };
  }

  await confirm.click();
  await page.waitForTimeout(1_000);
  return { ...base, deleted: true };
};

const CHATGPT_RATE_LIMIT_REASON = "ChatGPT rate limit (HTTP 429)";
const CONVERSATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;

interface ConversationApiReply {
  conversation_template_id: string | null;
  title: string | null;
}

interface ConversationApiRead {
  state: ChatGptApiReplyState;
  status: number;
  conversationTemplateId: string | null;
}

const readConversationApiPath = (conversationId: string): string =>
  `/backend-api/conversation/${encodeURIComponent(conversationId)}`;

const markMoveRateLimited = (base: MoveChatOutcome): MoveChatOutcome => ({
  ...base,
  rateLimited: true,
  reason: CHATGPT_RATE_LIMIT_REASON,
});

const readConversationApi = async (
  page: Page,
  conversationId: string,
): Promise<ConversationApiRead> => {
  const reply = await requestChatGptApi(page, {
    method: "GET",
    apiPath: readConversationApiPath(conversationId),
  });
  const state = readChatGptApiReplyStateFrom(reply.status);

  const isNotReadOk = state !== "ok";
  if (isNotReadOk) return { state, status: reply.status, conversationTemplateId: null };

  const conversation = JSON.parse(reply.bodyText) as ConversationApiReply;
  return {
    state,
    status: reply.status,
    conversationTemplateId: conversation.conversation_template_id,
  };
};

const findConversationIdForChat = async (page: Page, chat: string): Promise<string | null> => {
  const conversationId = stripConversationId(chat);

  const isIdentifier = CONVERSATION_ID_PATTERN.test(conversationId);
  if (isIdentifier) return conversationId;

  const results = await searchChatGptConversations(page, { query: chat, limit: 20 });
  const exactResult = results.find((result) => result.title.trim() === chat.trim());
  return exactResult?.id ?? null;
};

// One PATCH moves the chat; a GET before and after decides what happened. A 429 is reported as
// rateLimited so the queue defers the item without spending an attempt.
export const moveChatToProject = async (
  page: Page,
  input: MoveChatInput,
): Promise<MoveChatOutcome> => {
  const base: MoveChatOutcome = { chat: input.chat, project: input.project, moved: false };
  const conversationId = await findConversationIdForChat(page, input.chat);

  const isChatMissing = conversationId === null;
  if (isChatMissing) return { ...base, reason: `no chat titled "${input.chat}"` };

  const before = await readConversationApi(page, conversationId);
  if (before.state === "rate-limited") return markMoveRateLimited(base);

  if (before.state === "failed") {
    return { ...base, reason: `ChatGPT returned HTTP ${before.status} for the chat` };
  }

  const isAlreadyFiled = before.conversationTemplateId === input.projectId;
  if (isAlreadyFiled) {
    return { ...base, alreadyFiled: true, reason: `already in project "${input.project}"` };
  }

  const moveReply = await requestChatGptApi(page, {
    method: "PATCH",
    apiPath: readConversationApiPath(conversationId),
    body: { gizmo_id: input.projectId },
  });

  const moveState = readChatGptApiReplyStateFrom(moveReply.status);
  const isMoveRateLimited = moveState === "rate-limited";
  if (isMoveRateLimited) return markMoveRateLimited(base);

  const isMoveFailed = moveState === "failed";
  if (isMoveFailed) {
    return {
      ...base,
      reason: `ChatGPT rejected the move into project "${input.project}" (HTTP ${moveReply.status})`,
    };
  }

  const after = await readConversationApi(page, conversationId);
  if (after.state === "rate-limited") return markMoveRateLimited(base);

  const isNotMoveConfirmed = after.conversationTemplateId !== input.projectId;
  if (isNotMoveConfirmed) {
    return { ...base, reason: `ChatGPT did not confirm the move into project "${input.project}"` };
  }

  return { ...base, moved: true };
};

const requireChatGptReplyOk = (reply: ChatGptApiReply, action: string): void => {
  const state = readChatGptApiReplyStateFrom(reply.status);

  const isReplyOk = state === "ok";
  if (isReplyOk) return;

  const isRateLimited = state === "rate-limited";
  if (isRateLimited) {
    throw new Error(`ChatGPT rate-limited the chat ${action} (HTTP 429). Resume later.`);
  }

  throw new Error(`ChatGPT chat ${action} failed with HTTP ${reply.status}.`);
};

// One PATCH renames the chat; a GET confirms the title ChatGPT now stores. Any failure throws.
export const renameChat = async (page: Page, input: RenameChatInput): Promise<RenamedChat> => {
  const conversationId = await findConversationIdForChat(page, input.chat);

  const isChatMissing = conversationId === null;
  if (isChatMissing) throw new Error(`no chat titled "${input.chat}"`);

  const renameReply = await requestChatGptApi(page, {
    method: "PATCH",
    apiPath: readConversationApiPath(conversationId),
    body: { title: input.title },
  });
  requireChatGptReplyOk(renameReply, "rename");

  const confirmReply = await requestChatGptApi(page, {
    method: "GET",
    apiPath: readConversationApiPath(conversationId),
  });
  requireChatGptReplyOk(confirmReply, "rename check");
  const conversation = JSON.parse(confirmReply.bodyText) as ConversationApiReply;

  const isNotTitleConfirmed = conversation.title !== input.title;
  if (isNotTitleConfirmed) {
    throw new Error(`ChatGPT did not confirm the new title for chat ${conversationId}.`);
  }

  return { id: conversationId, title: input.title };
};

// Archive is reversible (Settings → Archived chats). Reports skips; never throws.
export const archiveChat = async (page: Page, chat: string): Promise<ArchiveChatOutcome> => {
  const base: ArchiveChatOutcome = { chat, archived: false };

  const isConversationMenuNotOpened = !(await openConversationMenu(page, chat));
  if (isConversationMenuNotOpened) {
    return { ...base, reason: "could not open the chat ⋯ menu" };
  }

  const archiveItem = page
    .locator(`${WORKSPACE.menuItem}:visible`)
    .filter({ hasText: /^archive$/i })
    .first();
  const archiveItemVisible = await archiveItem.isVisible({ timeout: 2_000 }).catch(() => false);
  const isArchiveItemHidden = !archiveItemVisible;
  if (isArchiveItemHidden) {
    await dismissMenu(page);
    return { ...base, reason: "no 'Archive' option for this chat" };
  }

  await archiveItem.click();
  await page.waitForTimeout(600);
  return { ...base, archived: true };
};

// Sidebar is virtualized: open the conversation so its active row mounts, then scroll.
const findChatRow = async (page: Page, chat: string): Promise<Locator | null> => {
  const id = stripConversationId(chat);
  // Project-owned chats use `/g/g-p-…/c/<id>`; unfiled chats use `/c/<id>`.
  const byHref = page.locator(`nav a[href*="/c/${id}"]`).first();
  const byTitle = page.locator(WORKSPACE.chatLink, { hasText: chat }).first();

  const byHrefCount = await byHref.count();
  const hasHrefMatch = byHrefCount > 0;
  if (hasHrefMatch) return byHref;

  const looksLikeId = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id);
  const isIdMissingFromUrl = looksLikeId && !page.url().includes(`/c/${id}`);
  if (isIdMissingFromUrl) {
    await gotoStable(page, `https://chatgpt.com/c/${id}`);

    const hasHrefMatchAfterWait = (await byHref.count()) > 0;
    if (hasHrefMatchAfterWait) return byHref;

    const isConversationMenuActive = await waitForActiveConversationMenu(page, id);
    if (isConversationMenuActive) return null;
  }

  const byTitleCount = await byTitle.count();
  const hasTitleMatch = byTitleCount > 0;
  if (hasTitleMatch) return byTitle;

  const isConversationMenuOpenById = looksLikeId && (await waitForActiveConversationMenu(page, id));
  if (isConversationMenuOpenById) return null;

  // Reset to top: a prior multi-chat op can leave the list scrolled mid-history.
  await page.evaluate(() => {
    const anchor = document.querySelector('nav a[href*="/c/"]');
    let el = anchor ? anchor.closest("nav") : document.querySelector("nav");
    while (el && el.scrollHeight <= el.clientHeight + 20) el = el.parentElement;

    const hasEl = el !== null;
    if (hasEl) {
      el.scrollTo(0, 0);
      return;
    }

    document.scrollingElement?.scrollTo(0, 0);
  });
  await page.waitForTimeout(250);
  // Stop only after rendered-link count stops growing — a single no-op scrollBy near a
  // boundary is not enough to give up.
  let prev = -1;
  let stable = 0;
  for (let i = 0; i < 80 && stable < 4; i += 1) {
    const hasHrefRow = (await byHref.count()) > 0;
    if (hasHrefRow) return byHref;

    const hasTitleRow = (await byTitle.count()) > 0;
    if (hasTitleRow) return byTitle;

    await page.evaluate(() => {
      const anchor = document.querySelector('nav a[href*="/c/"]');
      let el = anchor ? anchor.closest("nav") : document.querySelector("nav");
      while (el && el.scrollHeight <= el.clientHeight + 20) el = el.parentElement;

      const hasEl = el !== null;
      if (hasEl) {
        el.scrollBy(0, 800);
        return;
      }

      document.scrollingElement?.scrollBy(0, 800);
    });
    await page.waitForTimeout(220);

    const count = await page.locator(WORKSPACE.chatLink).count();
    const isCountUnchanged = count === prev;
    if (isCountUnchanged) {
      stable += 1;
    } else {
      stable = 0;
    }

    prev = count;
  }
  return null;
};

// Options button is inside the row anchor (not a sibling). Radix trigger under sticky
// header intercepts coordinate clicks — dispatch pointerdown on the element.
const openChatMenu = async (page: Page, row: Locator): Promise<boolean> => {
  const rowWithOptions = row.locator(
    `xpath=ancestor-or-self::*[.//button[${SIDEBAR_OPTIONS_BUTTON_XPATH}]][1]`,
  );
  const rowWithOptionsCount = await rowWithOptions.count();
  const hasRowWithOptions = rowWithOptionsCount > 0;
  const scope = hasRowWithOptions ? rowWithOptions : row;
  await scope.hover().catch(() => {});
  await page.waitForTimeout(200);
  const optionsButton = scope.locator(WORKSPACE.sidebarOptionsButton).first();

  const optionsButtonCount = await optionsButton.count();
  const isOptionsButtonMissing = optionsButtonCount === 0;
  if (isOptionsButtonMissing) return false;

  try {
    await optionsButton.dispatchEvent("pointerdown", {
      button: 0,
      isPrimary: true,
      pointerType: "mouse",
    });
    await page.locator(`${WORKSPACE.menuItem}:visible`).first().waitFor({ timeout: 4_000 });
    return true;
  } catch {
    return false;
  }
};

const openConversationMenu = async (page: Page, chat: string): Promise<boolean> => {
  let targetConversationId = stripConversationId(chat);

  const targetLooksLikeId = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(targetConversationId);
  const isTargetConversationOpen =
    targetLooksLikeId &&
    readChatGptConversationIdFromUrl(page.url()) === targetConversationId &&
    (await openActiveConversationMenu(page, targetConversationId));
  if (isTargetConversationOpen) {
    return true;
  }

  const row = await findChatRow(page, chat);
  const hasRow = row !== null;
  if (hasRow) {
    const isSidebarMenuOpen = await openChatMenu(page, row);

    const shouldTryHeaderMenu = !isSidebarMenuOpen && targetLooksLikeId;
    const isHeaderMenuSkipped = !shouldTryHeaderMenu;
    if (isHeaderMenuSkipped) return isSidebarMenuOpen;

    await gotoStable(page, `https://chatgpt.com/c/${targetConversationId}`);
    return openActiveConversationMenu(page, targetConversationId);
  }

  const isNotTargetLooksLikeId = !targetLooksLikeId;
  if (isNotTargetLooksLikeId) {
    const results = await searchChatGptConversations(page, { query: chat, limit: 20 });

    const exactResult = results.find((result) => result.title.trim() === chat.trim());
    const isExactMissing = exactResult === undefined;
    if (isExactMissing) return false;

    targetConversationId = exactResult.id;
    await gotoStable(page, exactResult.url);
  }

  return openActiveConversationMenu(page, targetConversationId);
};

const openActiveConversationMenu = async (
  page: Page,
  targetConversationId: string,
): Promise<boolean> => {
  const isConversationMenuStillClosed = !(await waitForActiveConversationMenu(
    page,
    targetConversationId,
  ));
  if (isConversationMenuStillClosed) return false;

  const trigger = page.locator(WORKSPACE.activeConversationMenu).first();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const isFirstAttempt = attempt === 0;
    if (isFirstAttempt) await trigger.click().catch(() => {});
    else {
      await dismissMenu(page);
      await trigger
        .dispatchEvent(
          "pointerdown",
          {
            button: 0,
            isPrimary: true,
            pointerType: "mouse",
          },
          { timeout: 2_000 },
        )
        .catch(() => {});
    }

    let menuVisible = false;
    try {
      await page
        .locator(`${WORKSPACE.menuItem}:visible`)
        .first()
        .waitFor({ state: "visible", timeout: 4_000 });
      menuVisible = true;
    } catch {
      menuVisible = false;
    }

    if (menuVisible) return true;
  }
  return false;
};

const waitForActiveConversationMenu = async (
  page: Page,
  conversationId: string,
): Promise<boolean> => {
  const trigger = page.locator(WORKSPACE.activeConversationMenu).first();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const activeConversationId = readChatGptConversationIdFromUrl(page.url());
    const isConversationActive = activeConversationId === conversationId;
    if (isConversationActive) {
      try {
        await trigger.waitFor({ state: "visible", timeout: 500 });
        return true;
      } catch {
        // ChatGPT can update the project-scoped URL before mounting the header controls.
      }
    }

    await page.waitForTimeout(250);
  }
  return false;
};

// The open chat menu heads its "Move to project" rows with the current project's name.
// The label appears a moment after the menu opens, so poll for it.
// ChatGPT saves a move a moment after the click, and a reload too early cancels it.
const dismissMenu = async (page: Page): Promise<void> => {
  await page.keyboard.press("Escape").catch(() => {});
  await page.keyboard.press("Escape").catch(() => {});
};

export const listTasks = async (page: Page): Promise<WorkspaceTask[]> => {
  const isNotScheduledPage = !page.url().startsWith(WORKSPACE.scheduledUrl);
  if (isNotScheduledPage) {
    await gotoStable(page, WORKSPACE.scheduledUrl);
    await page.waitForTimeout(1_200);
  }

  return page.evaluate<WorkspaceTask[]>(SCHEDULED_ROWS_SOURCE);
};

export const stripConversationId = (idOrUrl: string): string => {
  const conversationId = readChatGptConversationIdFromUrl(idOrUrl);

  const isConversationIdMissing = conversationId === null;
  if (isConversationIdMissing) return idOrUrl;

  return conversationId;
};
