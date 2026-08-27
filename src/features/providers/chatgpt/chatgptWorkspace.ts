import type { Locator, Page } from "playwright";
import { searchChatGptConversations } from "./chatgptConversationSearch.ts";
import { chatGptConversationIdFromUrl } from "./chatgptConversationUrl.ts";

// ChatGPT-only workspace ops (Projects, chat→project moves, Scheduled tasks). Not on
// BrowserProvider — Gemini has no equivalent. Selectors from live DOM capture
// (scripts/dev/captureChatgptSelectors.mjs); prefer stable data-testids.

const WORKSPACE = {
  projectsUrl: "https://chatgpt.com/projects",
  scheduledUrl: "https://chatgpt.com/scheduled",
  sidebarProjects: '[data-testid="sidebar-item-projects"]',
  sidebarTasks: '[data-testid="sidebar-item-tasks"]',
  newProjectButton: 'button[aria-label="New project"]',
  projectNameInput: 'input[name="projectName"]',
  projectFolderIcon: '[data-testid="project-folder-icon"]',
  projectDirectoryRow:
    '[data-testid="project-directory-scroll-root"] [role="row"]:has([role="gridcell"])',
  projectConversationLink: 'main a[href*="/c/"]',
  chatLink: 'nav a[href*="/c/"]',
  activeConversationMenu: '[data-testid="conversation-options-button"]',
  menuItem: '[role="menuitem"]',
} as const;

export const projectNameFromDirectoryRowText = (text: string): string | null => {
  const [name, detail] = text.split("\n");
  if (name === undefined) return null;
  const projectName = name.trim();
  if (!projectName) return null;
  if (projectName === "Name" && detail !== undefined && detail.trim() === "Modified") return null;
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

// chat: conversation id (`/c/<id>`) or exact sidebar title.
export type MoveChatInput = {
  chat: string;
  project: string;
};

export const chatGptProjectRemovalState = (
  namedRemoval: boolean,
  genericRemoval: boolean,
): "already-filed" | "current-project-unknown" | "not-filed" => {
  if (namedRemoval) return "already-filed";
  if (genericRemoval) return "current-project-unknown";
  return "not-filed";
};

export const chatGptProjectNameFromConversationAriaLabel = (label: string): string | null => {
  const marker = ", chat in project ";
  const markerIndex = label.lastIndexOf(marker);
  if (markerIndex < 0) return null;
  const project = label.slice(markerIndex + marker.length).trim();
  if (!project) return null;
  return project;
};

export const listProjects = async (page: Page): Promise<WorkspaceProject[]> => {
  await ensureOnProjectsPage(page);
  const directoryRows = page.locator(WORKSPACE.projectDirectoryRow);
  await directoryRows
    .first()
    .waitFor({ timeout: 5_000 })
    .catch(() => {});
  const directoryNames = (await directoryRows.allInnerTexts())
    .map(projectNameFromDirectoryRowText)
    .filter((name): name is string => name !== null);
  if (directoryNames.length > 0) {
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

const openProject = async (page: Page, project: string): Promise<boolean> => {
  await ensureOnProjectsPage(page);
  const directoryRows = page.locator(WORKSPACE.projectDirectoryRow);
  await directoryRows
    .first()
    .waitFor({ state: "visible", timeout: 8_000 })
    .catch(() => {});
  const directoryIndex = (await directoryRows.allInnerTexts()).findIndex(
    (rowText) => projectNameFromDirectoryRowText(rowText) === project,
  );
  if (directoryIndex >= 0) {
    await directoryRows.nth(directoryIndex).evaluate((row) => {
      if (row instanceof HTMLElement) row.click();
    });
    const heading = page.locator("main").getByText(project, { exact: true }).first();
    try {
      await heading.waitFor({ state: "visible", timeout: 8_000 });
      return true;
    } catch {
      return false;
    }
  }
  try {
    await page.locator(WORKSPACE.projectFolderIcon).first().waitFor({
      state: "visible",
      timeout: 8_000,
    });
  } catch {
    return false;
  }
  const projectRows = page
    .locator(WORKSPACE.projectFolderIcon)
    .locator('xpath=ancestor::*[@role="row" or self::a or self::li][1]');
  const rowCount = await projectRows.count();
  for (let index = 0; index < rowCount; index += 1) {
    const projectRow = projectRows.nth(index);
    const [projectName] = (await projectRow.innerText()).split("\n");
    if (projectName?.trim() !== project) continue;
    await projectRow.evaluate((row) => {
      if (row instanceof HTMLElement) row.click();
    });
    const heading = page.locator("main").getByText(project, { exact: true }).first();
    try {
      await heading.waitFor({ state: "visible", timeout: 8_000 });
      return true;
    } catch {
      return false;
    }
  }
  return false;
};

const projectPageContainsConversation = async (
  page: Page,
  conversation: string,
): Promise<boolean> => {
  const identifier = stripConversationId(conversation);
  const identifierIsId = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(identifier);
  for (let poll = 0; poll < 50; poll += 1) {
    const found = await page.locator(WORKSPACE.projectConversationLink).evaluateAll(
      (links, target) => {
        for (const link of links) {
          const href = link.getAttribute("href");
          if (href !== null && target.identifierIsId && href.includes(`/c/${target.identifier}`)) {
            return true;
          }
          const text = link instanceof HTMLElement ? link.innerText : link.textContent;
          let normalizedText = "";
          if (text !== null) normalizedText = text;
          const title = normalizedText.split("\n")[0]?.trim();
          if (!target.identifierIsId && title === target.identifier) return true;
        }
        return false;
      },
      { identifier, identifierIsId },
    );
    if (found) return true;
    const loadMore = page.getByText("Load more conversations", { exact: true }).first();
    if (!(await loadMore.isVisible())) {
      // Project navigation can render the heading several seconds before its chat cards.
      // Keep polling before treating an empty page as proof that the chat is absent.
      if (poll >= 19) return false;
      await page.waitForTimeout(500);
      continue;
    }
    await loadMore.evaluate((label) => {
      let clickTarget: Element = label;
      const button = label.closest("button");
      if (button !== null) clickTarget = button;
      if (clickTarget instanceof HTMLElement) clickTarget.click();
    });
    await page.waitForTimeout(700);
  }
  return false;
};

const projectContainsConversation = async (
  page: Page,
  project: string,
  conversation: string,
): Promise<boolean> => {
  const originalUrl = page.url();
  try {
    if (!(await openProject(page, project))) return false;
    await page.waitForTimeout(800);
    return await projectPageContainsConversation(page, conversation);
  } finally {
    if (page.url() !== originalUrl) await gotoStable(page, originalUrl);
  }
};

const conversationLinkIdentifiesProject = async (
  page: Page,
  conversation: string,
  project: string,
): Promise<boolean> => {
  const identifier = stripConversationId(conversation);
  const identifierIsId = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(identifier);
  let links = page.locator(WORKSPACE.chatLink);
  if (identifierIsId) links = page.locator(`nav a[href*="/c/${identifier}"]`);
  else links = links.filter({ hasText: exactName(identifier) });
  const count = await links.count();
  for (let index = 0; index < count; index += 1) {
    const ariaLabel = await links.nth(index).getAttribute("aria-label");
    if (ariaLabel === null) continue;
    if (chatGptProjectNameFromConversationAriaLabel(ariaLabel) === project) return true;
  }
  return false;
};

const activeConversationHeaderIdentifiesProject = async (
  page: Page,
  project: string,
): Promise<boolean> => {
  if (!/\/g\/g-p-[^/]+\/c\//i.test(page.url())) return false;
  try {
    await page
      .locator("header")
      .getByText(project, { exact: true })
      .first()
      .waitFor({ state: "visible", timeout: 2_000 });
    return true;
  } catch {
    return false;
  }
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
      if (attempt === 0 && interrupted) {
        await page.waitForLoadState("domcontentloaded").catch(() => {});
        continue;
      }
      throw error;
    }
  }
};

const ensureOnProjectsPage = async (page: Page): Promise<void> => {
  if (page.url().startsWith(WORKSPACE.projectsUrl)) return;
  await gotoStable(page, WORKSPACE.projectsUrl);
  await page.waitForTimeout(800);
};

export const createProject = async (page: Page, name: string): Promise<WorkspaceProject> => {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Project name is required.");
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
    if (el instanceof HTMLElement) el.click();
  });
};

const submitCreateProject = async (page: Page): Promise<void> => {
  const button = page.getByRole("button", { name: /create project/i }).first();
  if (await button.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await button.click();
    return;
  }
  await page.locator(WORKSPACE.projectNameInput).first().press("Enter");
};

// Trigger: button[aria-label="Open project options for <name>"]. Opens on
// dispatched pointerdown rather than a coordinate click.
const openProjectMenu = async (page: Page, project: string): Promise<boolean> => {
  const trigger = page.getByRole("button", { name: `Open project options for ${project}` }).first();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt === 0) await ensureOnProjectsPage(page);
    else {
      await gotoStable(page, WORKSPACE.projectsUrl);
      await page.waitForTimeout(1_000);
    }
    const attached = await trigger
      .waitFor({ state: "attached", timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (!attached) continue;
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
  if (!base.renamedTo) return { ...base, reason: "a new name is required" };
  const field = page.locator('input[aria-label="Project name"]').first();
  let opened = false;
  for (let attempt = 0; attempt < 3 && !opened; attempt += 1) {
    if (attempt > 0) await dismissMenu(page);
    if (!(await openProjectMenu(page, input.project))) {
      return { ...base, reason: `project "${input.project}" not found` };
    }
    const settings = page.getByRole("menuitem", { name: "Project settings" }).first();
    if (!(await settings.isVisible({ timeout: 2_000 }).catch(() => false))) {
      await dismissMenu(page);
      return { ...base, reason: "no 'Project settings' option" };
    }
    await settings.click().catch(() => {});
    opened = await field.isVisible({ timeout: 3_500 }).catch(() => false);
  }
  if (!opened) {
    await dismissMenu(page);
    return { ...base, reason: "the project name field did not open" };
  }
  // Real keystrokes so React's controlled input registers the change.
  await field.click();
  await field.press("ControlOrMeta+a");
  await field.pressSequentially(base.renamedTo, { delay: 15 });
  const save = page.getByRole("button", { name: "Save", exact: true }).first();
  if (!(await save.isVisible({ timeout: 2_500 }).catch(() => false))) {
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
  const confirm = page.getByRole("button", { name: "Delete", exact: true }).first();
  let confirmVisible = false;
  for (let attempt = 0; attempt < 3 && !confirmVisible; attempt += 1) {
    if (attempt > 0) await dismissMenu(page);
    if (!(await openProjectMenu(page, project))) {
      return { ...base, reason: `project "${project}" not found` };
    }
    const del = page.getByRole("menuitem", { name: "Delete project" }).first();
    if (!(await del.isVisible({ timeout: 2_000 }).catch(() => false))) {
      await dismissMenu(page);
      return { ...base, reason: "no 'Delete project' option" };
    }
    await del.click().catch(() => {});
    confirmVisible = await confirm.isVisible({ timeout: 3_000 }).catch(() => false);
  }
  if (!confirmVisible) {
    await dismissMenu(page);
    return { ...base, reason: "the delete confirmation did not appear" };
  }
  await confirm.click();
  await page.waitForTimeout(1_000);
  return { ...base, deleted: true };
};

export const moveChatToProject = async (
  page: Page,
  input: MoveChatInput,
): Promise<MoveChatOutcome> => {
  const base: MoveChatOutcome = { chat: input.chat, project: input.project, moved: false };
  const conversationId = stripConversationId(input.chat);
  const identifierIsId = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(conversationId);
  if (identifierIsId && chatGptConversationIdFromUrl(page.url()) !== conversationId) {
    await gotoStable(page, `https://chatgpt.com/c/${conversationId}`);
    await waitForActiveConversationMenu(page, conversationId);
  }
  if (
    (await activeConversationHeaderIdentifiesProject(page, input.project)) ||
    (await conversationLinkIdentifiesProject(page, input.chat, input.project))
  ) {
    return {
      ...base,
      alreadyFiled: true,
      reason: `already in project "${input.project}"`,
    };
  }
  if (!(await openConversationMenu(page, input.chat))) {
    return { ...base, reason: "could not open the chat ⋯ menu" };
  }
  const visibleMenuItems = page.locator(`${WORKSPACE.menuItem}:visible`);
  const moveItem = visibleMenuItems.filter({ hasText: /^Move to project$/i }).first();
  try {
    await moveItem.waitFor({ state: "visible", timeout: 5_000 });
  } catch {
    await dismissMenu(page);
    return { ...base, reason: "no 'Move to project' option (GPT- or project-owned chat)" };
  }
  // Hover expands the project submenu; poll before falling back to a click (clicking an
  // already-open trigger can toggle it shut). Match visible text, not accessible name:
  // each project item's folder-icon svg pollutes the computed name with "Default color…Folder".
  const targetOf = () =>
    page
      .locator(`${WORKSPACE.menuItem}:visible`)
      .filter({ hasText: exactName(input.project) })
      .first();
  const removalStateOf = async () => {
    const namedRemoval = page.locator(`${WORKSPACE.menuItem}:visible`).filter({
      hasText: new RegExp(`^Remove from ${escapeRegExp(input.project)}$`, "i"),
    });
    const genericRemoval = page
      .locator(`${WORKSPACE.menuItem}:visible`)
      .filter({ hasText: /^Remove from project$/i });
    return chatGptProjectRemovalState(
      (await namedRemoval.count()) > 0,
      (await genericRemoval.count()) > 0,
    );
  };
  const newProjectItem = page
    .locator(`${WORKSPACE.menuItem}:visible`)
    .filter({ hasText: /^New project$/i });
  await moveItem.hover().catch(() => {});
  let target = targetOf();
  let visible = false;
  let removalState: ReturnType<typeof chatGptProjectRemovalState> = "not-filed";
  let submenuVisible = false;
  for (let attempt = 0; attempt < 2 && !visible && removalState === "not-filed"; attempt += 1) {
    if (attempt > 0 && !submenuVisible) await moveItem.click().catch(() => {});
    for (let poll = 0; poll < 40 && !visible && removalState === "not-filed"; poll += 1) {
      try {
        await target.waitFor({ state: "visible", timeout: 350 });
        visible = true;
      } catch {
        visible = false;
      }
      removalState = await removalStateOf();
      submenuVisible = submenuVisible || (await newProjectItem.count()) > 0;
      if (!visible && removalState === "not-filed") await page.waitForTimeout(150);
      target = targetOf();
    }
  }
  if (!visible) {
    // The submenu omits the current project and labels its removal action with or without a name.
    await dismissMenu(page);
    if (removalState === "already-filed") {
      return {
        ...base,
        alreadyFiled: true,
        reason: `already in project "${input.project}"`,
      };
    }
    if (removalState === "current-project-unknown") {
      let confirmed = await conversationLinkIdentifiesProject(page, input.chat, input.project);
      if (!confirmed)
        confirmed = await projectContainsConversation(page, input.project, input.chat);
      if (confirmed) {
        return {
          ...base,
          alreadyFiled: true,
          reason: `already in project "${input.project}"`,
        };
      }
      return {
        ...base,
        reason: `chat is already in a project, but ChatGPT did not identify which one`,
      };
    }
    return {
      ...base,
      reason: `project "${input.project}" not found — create it first`,
    };
  }
  const projectSelected = await target
    .evaluate((projectItem) => {
      if (projectItem instanceof HTMLElement) projectItem.click();
    })
    .then(() => true)
    .catch(() => false);
  if (!projectSelected) {
    await dismissMenu(page);
    return { ...base, reason: `could not select project "${input.project}"` };
  }
  await page.waitForTimeout(800);
  let confirmed = await activeConversationHeaderIdentifiesProject(page, input.project);
  if (!confirmed)
    confirmed = await conversationLinkIdentifiesProject(page, input.chat, input.project);
  if (!confirmed) confirmed = await projectContainsConversation(page, input.project, input.chat);
  if (!confirmed) {
    return {
      ...base,
      reason: `ChatGPT did not confirm the move into project "${input.project}"`,
    };
  }
  return { ...base, moved: true };
};

// Archive is reversible (Settings → Archived chats). Reports skips; never throws.
export const archiveChat = async (page: Page, chat: string): Promise<ArchiveChatOutcome> => {
  const base: ArchiveChatOutcome = { chat, archived: false };
  if (!(await openConversationMenu(page, chat))) {
    return { ...base, reason: "could not open the chat ⋯ menu" };
  }
  const archiveItem = page
    .locator(`${WORKSPACE.menuItem}:visible`)
    .filter({ hasText: /^archive$/i })
    .first();
  if (!(await archiveItem.isVisible({ timeout: 2_000 }).catch(() => false))) {
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
  if ((await byHref.count()) > 0) return byHref;
  const looksLikeId = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id);
  if (looksLikeId && !page.url().includes(`/c/${id}`)) {
    await gotoStable(page, `https://chatgpt.com/c/${id}`);
    if ((await byHref.count()) > 0) return byHref;
    if (await waitForActiveConversationMenu(page, id)) return null;
  }
  if ((await byTitle.count()) > 0) return byTitle;
  if (looksLikeId && (await waitForActiveConversationMenu(page, id))) return null;
  // Reset to top: a prior multi-chat op can leave the list scrolled mid-history.
  await page.evaluate(() => {
    const anchor = document.querySelector('nav a[href*="/c/"]');
    let el = anchor ? anchor.closest("nav") : document.querySelector("nav");
    while (el && el.scrollHeight <= el.clientHeight + 20) el = el.parentElement;
    if (el !== null) {
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
    if ((await byHref.count()) > 0) return byHref;
    if ((await byTitle.count()) > 0) return byTitle;
    await page.evaluate(() => {
      const anchor = document.querySelector('nav a[href*="/c/"]');
      let el = anchor ? anchor.closest("nav") : document.querySelector("nav");
      while (el && el.scrollHeight <= el.clientHeight + 20) el = el.parentElement;
      if (el !== null) {
        el.scrollBy(0, 800);
        return;
      }
      document.scrollingElement?.scrollBy(0, 800);
    });
    await page.waitForTimeout(220);
    const count = await page.locator(WORKSPACE.chatLink).count();
    if (count === prev) {
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
  const li = row.locator("xpath=ancestor-or-self::li[1]");
  const scope = (await li.count()) > 0 ? li : row;
  await scope.hover().catch(() => {});
  await page.waitForTimeout(200);
  const optionsButton = scope.locator('button[aria-label^="Open conversation options"]').first();
  const trigger =
    (await optionsButton.count()) > 0 ? optionsButton : scope.getByRole("button").last();
  try {
    await trigger.dispatchEvent("pointerdown", {
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
  if (
    targetLooksLikeId &&
    chatGptConversationIdFromUrl(page.url()) === targetConversationId &&
    (await openActiveConversationMenu(page, targetConversationId))
  ) {
    return true;
  }
  const row = await findChatRow(page, chat);
  if (row !== null) return openChatMenu(page, row);
  if (!targetLooksLikeId) {
    const results = await searchChatGptConversations(page, { query: chat, limit: 20 });
    const exactResult = results.find((result) => result.title.trim() === chat.trim());
    if (exactResult === undefined) return false;
    targetConversationId = exactResult.id;
    await gotoStable(page, exactResult.url);
  }
  return openActiveConversationMenu(page, targetConversationId);
};

const openActiveConversationMenu = async (
  page: Page,
  targetConversationId: string,
): Promise<boolean> => {
  if (!(await waitForActiveConversationMenu(page, targetConversationId))) return false;
  const trigger = page.locator(WORKSPACE.activeConversationMenu).first();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt === 0) await trigger.click().catch(() => {});
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
    const activeConversationId = chatGptConversationIdFromUrl(page.url());
    if (activeConversationId === conversationId) {
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

const dismissMenu = async (page: Page): Promise<void> => {
  await page.keyboard.press("Escape").catch(() => {});
  await page.keyboard.press("Escape").catch(() => {});
};

export const listTasks = async (page: Page): Promise<WorkspaceTask[]> => {
  if (!page.url().startsWith(WORKSPACE.scheduledUrl)) {
    await gotoStable(page, WORKSPACE.scheduledUrl);
    await page.waitForTimeout(1_200);
  }
  return page.evaluate<WorkspaceTask[]>(SCHEDULED_ROWS_SOURCE);
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const exactName = (value: string): RegExp => {
  return new RegExp(`^${escapeRegExp(value)}$`);
};

export const stripConversationId = (idOrUrl: string): string => {
  const conversationId = chatGptConversationIdFromUrl(idOrUrl);
  if (conversationId === null) return idOrUrl;
  return conversationId;
};
