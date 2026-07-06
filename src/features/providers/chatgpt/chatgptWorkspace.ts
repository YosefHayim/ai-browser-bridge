import type { Locator, Page } from "playwright";

// ChatGPT workspace operations — Projects, chat→project moves, and Scheduled tasks — driven
// through the signed-in web UI. These are ChatGPT-only and deliberately NOT part of the shared
// BrowserProvider interface (Gemini has no equivalent), so they live beside chatgptPage.ts as
// standalone functions that take a Playwright Page. Selectors were captured against the live
// DOM (see src/scripts/dev/captureChatgptSelectors.mjs); the stable data-testids are preferred and
// text/role locators back them up where ChatGPT ships no testid.

/** A ChatGPT Project (a named folder that groups conversations). */
export interface WorkspaceProject {
  /** Human-visible project name. */
  name: string;
}

/** Outcome of moving one conversation into a project. */
export interface MoveChatOutcome {
  /** Chat title or id the caller asked to move. */
  chat: string;
  /** Target project name. */
  project: string;
  /** Whether the move actually happened. */
  moved: boolean;
  /** Why the move was skipped, when `moved` is false. */
  reason?: string;
}

/** A ChatGPT Scheduled task (an automation that runs on a cadence). */
export interface WorkspaceTask {
  /** Task title as rendered on the Scheduled page. */
  title: string;
  /** Cadence/next-run text when ChatGPT exposes it. */
  schedule?: string;
}

/** Workspace DOM selectors, captured from the live ChatGPT UI. */
const WORKSPACE = {
  projectsUrl: "https://chatgpt.com/projects",
  scheduledUrl: "https://chatgpt.com/scheduled",
  sidebarProjects: '[data-testid="sidebar-item-projects"]',
  sidebarTasks: '[data-testid="sidebar-item-tasks"]',
  newProjectButton: 'button[aria-label="New project"]',
  projectNameInput: 'input[name="projectName"]',
  projectFolderIcon: '[data-testid="project-folder-icon"]',
  chatLink: 'nav a[href^="/c/"]',
  menuItem: '[role="menuitem"]',
} as const;

// --- projects/list-projects.ts ---

/** In-page scrape of project rows on the /projects table. The project name is the first
 *  text-bearing leaf in the row (the primary-text cell); date columns follow it. */
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
// --- tasks/list-tasks.ts ---

/** In-page scrape of scheduled-task rows on the /scheduled page. */
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

/**
 * List the ChatGPT Projects visible on the /projects page.
 *
 * @param page - Playwright page to operate on.
 * @returns The `listProjects` result.
 * @example
 * ```ts
 * const result = await listProjects(page);
 * ```
 */
export const listProjects = async (page: Page): Promise<WorkspaceProject[]> => {
  await ensureOnProjectsPage(page);
  await page
    .locator(WORKSPACE.projectFolderIcon)
    .first()
    .waitFor({ timeout: 5_000 })
    .catch(() => {});
  const names = await page.evaluate<string[]>(PROJECT_ROWS_SOURCE);
  return names.map((name) => ({ name }));
};

/** Navigate to the /projects page when the active tab is elsewhere. */
const ensureOnProjectsPage = async (page: Page): Promise<void> => {
  if (page.url().startsWith(WORKSPACE.projectsUrl)) return;
  await page.goto(WORKSPACE.projectsUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
};

// --- projects/create-project.ts ---

/**
 * Create a new ChatGPT Project and return its record. Throws if the name field never appears.
 *
 * @param page - Playwright page to operate on.
 * @param name - Name value.
 * @returns The `createProject` result.
 * @example
 * ```ts
 * const result = await createProject(page, name);
 * ```
 */
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

/** Reveal and click the sidebar "New project" control (hover-revealed at rest). */
const openNewProjectPanel = async (page: Page): Promise<void> => {
  await page
    .locator(WORKSPACE.sidebarProjects)
    .first()
    .hover()
    .catch(() => {});
  await page.waitForTimeout(200);
  await page.locator(WORKSPACE.newProjectButton).first().click({ force: true, timeout: 8_000 });
};

/** Submit the "Create project" panel via its button, falling back to Enter. */
const submitCreateProject = async (page: Page): Promise<void> => {
  const button = page.getByRole("button", { name: /create project/i }).first();
  if (await button.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await button.click();
    return;
  }
  await page.locator(WORKSPACE.projectNameInput).first().press("Enter");
};

// --- chats/move-chat-to-project.ts ---

/** Input for {@link moveChatToProject}. */
export interface MoveChatInput {
  /** Conversation id (`/c/<id>`) or exact chat title as shown in the sidebar. */
  chat: string;
  /** Destination project name (must already exist). */
  project: string;
}

/**
 * Move a sidebar conversation into a project via its ⋯ menu. Reports (never throws) on skips.
 *
 * @param page - Playwright page to operate on.
 * @param input - Input values for the operation.
 * @returns The `moveChatToProject` result.
 * @example
 * ```ts
 * const result = await moveChatToProject(page, input);
 * ```
 */
export const moveChatToProject = async (
  page: Page,
  input: MoveChatInput,
): Promise<MoveChatOutcome> => {
  const base: MoveChatOutcome = { chat: input.chat, project: input.project, moved: false };
  const row = await findChatRow(page, input.chat);
  if (!row) return { ...base, reason: "chat not found in the sidebar" };
  if (!(await openChatMenu(page, row))) {
    return { ...base, reason: "could not open the chat ⋯ menu" };
  }
  const moveItem = page.getByRole("menuitem", { name: /move to project/i }).first();
  if (!(await moveItem.isVisible({ timeout: 2_000 }).catch(() => false))) {
    await dismissMenu(page);
    return { ...base, reason: "no 'Move to project' option (GPT- or project-owned chat)" };
  }
  await moveItem.hover();
  await page.waitForTimeout(500);
  const target = page.getByRole("menuitem", { name: exactName(input.project) }).first();
  if (!(await target.isVisible({ timeout: 2_000 }).catch(() => false))) {
    await dismissMenu(page);
    return { ...base, reason: `project "${input.project}" not found — create it first` };
  }
  await target.click();
  await page.waitForTimeout(800);
  return { ...base, moved: true };
};

/** Locate a sidebar chat row by conversation id or exact title. */
const findChatRow = async (page: Page, chat: string) => {
  const byHref = page.locator(`nav a[href="/c/${stripConversationId(chat)}"]`).first();
  if ((await byHref.count()) > 0) return byHref;
  const byTitle = page.locator(WORKSPACE.chatLink, { hasText: chat }).first();
  return (await byTitle.count()) > 0 ? byTitle : null;
};

/** Hover a chat row and force-click its (hover-revealed) ⋯ options button. */
const openChatMenu = async (page: Page, row: Locator): Promise<boolean> => {
  await row.hover().catch(() => {});
  await page.waitForTimeout(200);
  const options = row
    .locator('xpath=following-sibling::*//button[contains(@aria-label,"conversation options")]')
    .first();
  const trigger = (await options.count()) > 0 ? options : row.getByRole("button").last();
  try {
    await trigger.click({ force: true, timeout: 5_000 });
    await page.locator(WORKSPACE.menuItem).first().waitFor({ timeout: 4_000 });
    return true;
  } catch {
    return false;
  }
};

/** Close any open popover menu without selecting an item. */
const dismissMenu = async (page: Page): Promise<void> => {
  await page.keyboard.press("Escape").catch(() => {});
  await page.keyboard.press("Escape").catch(() => {});
};

/**
 * List ChatGPT Scheduled tasks. Returns an empty array when none are configured.
 *
 * @param page - Playwright page to operate on.
 * @returns The `listTasks` result.
 * @example
 * ```ts
 * const result = await listTasks(page);
 * ```
 */
export const listTasks = async (page: Page): Promise<WorkspaceTask[]> => {
  if (!page.url().startsWith(WORKSPACE.scheduledUrl)) {
    await page.goto(WORKSPACE.scheduledUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1_200);
  }
  return page.evaluate<WorkspaceTask[]>(SCHEDULED_ROWS_SOURCE);
};

// --- shared ---

/**
 * Escape a project/chat name into an exact-match RegExp for getByRole name lookups.
 *
 * @param value - Value value.
 * @returns The `exactName` result.
 * @example
 * ```ts
 * const result = exactName(value);
 * ```
 */
export const exactName = (value: string): RegExp => {
  return new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
};

/**
 * Reduce a `/c/<id>` URL or bare id to just the conversation id.
 *
 * @param idOrUrl - Id or url value.
 * @returns The `stripConversationId` result.
 * @example
 * ```ts
 * const result = stripConversationId(idOrUrl);
 * ```
 */
export const stripConversationId = (idOrUrl: string): string => {
  const match = idOrUrl.match(/\/c\/([^/?#]+)/);
  return match?.[1] ?? idOrUrl;
};
