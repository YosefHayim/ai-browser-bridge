import type { Locator, Page } from "playwright";
import { chatGptConversationIdFromUrl } from "./chatgptConversationUrl.ts";

// ChatGPT workspace operations — Projects, chat→project moves, and Scheduled tasks — driven
// through the signed-in web UI. These are ChatGPT-only and deliberately NOT part of the shared
// BrowserProvider interface (Gemini has no equivalent), so they live beside chatgptPage.ts as
// standalone functions that take a Playwright Page. Selectors were captured against the live
// DOM (see src/scripts/dev/captureChatgptSelectors.mjs); the stable data-testids are preferred and
// text/role locators back them up where ChatGPT ships no testid.

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

/** A ChatGPT Project (a named folder that groups conversations). */
export interface WorkspaceProject {
  /** Human-visible project name. */
  name: string;
}

/** Outcome of renaming one project. */
export interface RenameProjectOutcome {
  /** Project name the caller asked to rename. */
  project: string;
  /** Requested new name. */
  renamedTo: string;
  /** Whether the rename actually happened. */
  renamed: boolean;
  /** Why the rename was skipped, when `renamed` is false. */
  reason?: string;
}

/** Outcome of deleting one project. */
export interface DeleteProjectOutcome {
  /** Project name the caller asked to delete. */
  project: string;
  /** Whether the delete actually happened. */
  deleted: boolean;
  /** Why the delete was skipped, when `deleted` is false. */
  reason?: string;
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

/** Outcome of archiving one conversation. */
export interface ArchiveChatOutcome {
  /** Chat title or id the caller asked to archive. */
  chat: string;
  /** Whether the archive actually happened. */
  archived: boolean;
  /** Why the archive was skipped, when `archived` is false. */
  reason?: string;
}

/** A ChatGPT Scheduled task (an automation that runs on a cadence). */
export interface WorkspaceTask {
  /** Task title as rendered on the Scheduled page. */
  title: string;
  /** Cadence/next-run text when ChatGPT exposes it. */
  schedule?: string;
}

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

/**
 * Navigate `page` to `url`, tolerating the abort a freshly-opened tab triggers while its own
 * initial navigation is still in flight (Playwright throws "interrupted by another navigation").
 */
const gotoStable = async (page: Page, url: string): Promise<void> => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      return;
    } catch (error) {
      // A just-opened tab still loading chatgpt.com aborts our goto; let it settle, retry once.
      const interrupted = /interrupted by another navigation/i.test(String(error));
      if (attempt === 0 && interrupted) {
        await page.waitForLoadState("domcontentloaded").catch(() => {});
        continue;
      }
      throw error;
    }
  }
};

/** Navigate to the /projects page when the active tab is elsewhere. */
const ensureOnProjectsPage = async (page: Page): Promise<void> => {
  if (page.url().startsWith(WORKSPACE.projectsUrl)) return;
  await gotoStable(page, WORKSPACE.projectsUrl);
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

// --- projects/rename-and-delete.ts ---

/** Open a project's ⋯ options menu on the /projects page. The trigger is
 *  `button[aria-label="Open project options for <name>"]`; like the chat ⋯ it opens on a
 *  dispatched `pointerdown` rather than a coordinate click. */
const openProjectMenu = async (page: Page, project: string): Promise<boolean> => {
  const trigger = page.getByRole("button", { name: `Open project options for ${project}` }).first();
  // The grid can still be rendering (fresh reload, or a prior tab left mid-navigation), so on the
  // first miss force a clean reload before giving up.
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
      await trigger.dispatchEvent("pointerdown", {
        button: 0,
        isPrimary: true,
        pointerType: "mouse",
      });
      await page.locator(WORKSPACE.menuItem).first().waitFor({ timeout: 4_000 });
      return true;
    } catch {
      await dismissMenu(page);
    }
  }
  return false;
};

/**
 * Rename a ChatGPT Project through its ⋯ → Project settings dialog. Editing the name field reveals
 * a Save button that must be clicked to persist (Close/Cancel discard). Reports (never throws) on
 * skips.
 *
 * @param page - Playwright page to operate on.
 * @param input - The project to rename and its new name.
 * @returns The `renameProject` result.
 * @example
 * ```ts
 * const result = await renameProject(page, { project: "Errands", name: "IFL Israel" });
 * ```
 */
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
  // Opening the settings dialog is occasionally flaky, so retry the menu → "Project settings" click
  // until the name field appears.
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
  // Real keystrokes (not fill) so React's controlled input registers the change. Editing the name
  // reveals Save/Cancel buttons; clicking Save persists it, while Close/Cancel discards.
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

/**
 * Delete a ChatGPT Project through its ⋯ → Delete project → confirm dialog. This permanently
 * deletes the project's chats, so callers gate it (the CLI requires `--yes`). Reports (never
 * throws) on skips.
 *
 * @param page - Playwright page to operate on.
 * @param project - Name of the project to delete.
 * @returns The `deleteProject` result.
 * @example
 * ```ts
 * const result = await deleteProject(page, "Errands");
 * ```
 */
export const deleteProject = async (page: Page, project: string): Promise<DeleteProjectOutcome> => {
  const base: DeleteProjectOutcome = { project, deleted: false };
  const confirm = page.getByRole("button", { name: "Delete", exact: true }).first();
  let confirmVisible = false;
  // The menu → "Delete project" click that opens the confirm dialog is occasionally flaky; retry.
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
  // Open the destination picker. Hovering "Move to project" expands the project submenu; poll for
  // the destination as it renders before falling back to a click. Clicking an already-hover-opened
  // trigger can toggle the submenu shut, which previously produced spurious "project not found".
  // Match on visible text, not accessible name: each project item's folder-icon <svg> carries an
  // aria-label ("Default color…Folder") that pollutes the computed name, so an anchored name match
  // never hits. The element's text content is the clean project name.
  const targetOf = () =>
    page
      .getByRole("menuitem")
      .filter({ hasText: exactName(input.project) })
      .first();
  await moveItem.hover().catch(() => {});
  let target = targetOf();
  let visible = false;
  for (let attempt = 0; attempt < 2 && !visible; attempt += 1) {
    if (attempt > 0) await moveItem.click().catch(() => {});
    for (let poll = 0; poll < 8 && !visible; poll += 1) {
      visible = await target.isVisible({ timeout: 350 }).catch(() => false);
      if (!visible) await page.waitForTimeout(150);
      target = targetOf();
    }
  }
  if (!visible) {
    // The submenu omits the chat's *current* project; that chat's menu instead offers a matching
    // "Remove from <project>" item, so its presence means the chat is already filed there.
    const removeHere = page.getByRole("menuitem").filter({
      hasText: new RegExp(`^Remove from ${escapeRegExp(input.project)}$`, "i"),
    });
    const alreadyFiled = (await removeHere.count()) > 0;
    await dismissMenu(page);
    return {
      ...base,
      reason: alreadyFiled
        ? `already in project "${input.project}"`
        : `project "${input.project}" not found — create it first`,
    };
  }
  await target.click();
  await page.waitForTimeout(800);
  return { ...base, moved: true };
};

// --- chats/archive-chat.ts ---

/**
 * Archive a sidebar conversation via its ⋯ menu — reversible: it hides the chat from the sidebar
 * (recoverable under Settings → Archived chats) rather than deleting it. Reports (never throws)
 * on skips, mirroring {@link moveChatToProject}.
 *
 * @param page - Playwright page to operate on.
 * @param chat - Conversation id (`/c/<id>`) or exact chat title as shown in the sidebar.
 * @returns The `archiveChat` result.
 * @example
 * ```ts
 * const result = await archiveChat(page, chat);
 * ```
 */
export const archiveChat = async (page: Page, chat: string): Promise<ArchiveChatOutcome> => {
  const base: ArchiveChatOutcome = { chat, archived: false };
  const row = await findChatRow(page, chat);
  if (!row) return { ...base, reason: "chat not found in the sidebar" };
  if (!(await openChatMenu(page, row))) {
    return { ...base, reason: "could not open the chat ⋯ menu" };
  }
  const archiveItem = page.getByRole("menuitem", { name: /^archive$/i }).first();
  if (!(await archiveItem.isVisible({ timeout: 2_000 }).catch(() => false))) {
    await dismissMenu(page);
    return { ...base, reason: "no 'Archive' option for this chat" };
  }
  await archiveItem.click();
  await page.waitForTimeout(600);
  return { ...base, archived: true };
};

/** Locate a sidebar chat row by conversation id or exact title. The sidebar is virtualized, so for
 *  chats far down the history we first open the conversation (its active row always mounts) and then
 *  scroll the list until the row renders. */
const findChatRow = async (page: Page, chat: string): Promise<Locator | null> => {
  const id = stripConversationId(chat);
  // Prefix match: a sidebar href may carry a `?messageId=…` suffix beyond the bare `/c/<id>`.
  const byHref = page.locator(`nav a[href^="/c/${id}"]`).first();
  const byTitle = page.locator(WORKSPACE.chatLink, { hasText: chat }).first();
  if ((await byHref.count()) > 0) return byHref;
  // Opening the conversation forces ChatGPT to mount + reveal its sidebar row, sidestepping list
  // virtualization when the target is not in the currently-rendered window.
  const looksLikeId = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id);
  if (looksLikeId && !page.url().includes(`/c/${id}`)) {
    await gotoStable(page, `https://chatgpt.com/c/${id}`);
    await page.waitForTimeout(700);
    if ((await byHref.count()) > 0) return byHref;
  }
  if ((await byTitle.count()) > 0) return byTitle;
  // Reset the sidebar to the top first: a prior move in a batch can leave it scrolled to the bottom,
  // and the down-only hunt below would otherwise never reach a row above that position.
  await page.evaluate(() => {
    const anchor = document.querySelector('nav a[href^="/c/"]');
    let el = anchor ? anchor.closest("nav") : document.querySelector("nav");
    while (el && el.scrollHeight <= el.clientHeight + 20) el = el.parentElement;
    (el ?? document.scrollingElement)?.scrollTo(0, 0);
  });
  await page.waitForTimeout(250);
  // Scroll the virtualized sidebar until the row (by href or title) renders. Stop only after the
  // rendered-link count stops growing for several steps — a single no-op scrollBy near a boundary is
  // not reason enough to give up (that early-exit previously missed rows deep in a long history).
  let prev = -1;
  let stable = 0;
  for (let i = 0; i < 80 && stable < 4; i += 1) {
    if ((await byHref.count()) > 0) return byHref;
    if ((await byTitle.count()) > 0) return byTitle;
    await page.evaluate(() => {
      const anchor = document.querySelector('nav a[href^="/c/"]');
      let el = anchor ? anchor.closest("nav") : document.querySelector("nav");
      while (el && el.scrollHeight <= el.clientHeight + 20) el = el.parentElement;
      (el ?? document.scrollingElement)?.scrollBy(0, 800);
    });
    await page.waitForTimeout(220);
    const count = await page.locator(WORKSPACE.chatLink).count();
    stable = count === prev ? stable + 1 : 0;
    prev = count;
  }
  return null;
};

/** Reveal and open a chat row's ⋯ actions menu. The button lives *inside* the row anchor as
 *  `aria-label="Open conversation options for <title>"` (data-testid `history-item-<n>-options`),
 *  not as a following sibling. It is a Radix trigger sitting under the sidebar's sticky header, so
 *  a coordinate click gets intercepted by that overlay — dispatch `pointerdown` on the element
 *  itself (its open-toggle handler) to open the menu reliably. */
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
    await gotoStable(page, WORKSPACE.scheduledUrl);
    await page.waitForTimeout(1_200);
  }
  return page.evaluate<WorkspaceTask[]>(SCHEDULED_ROWS_SOURCE);
};

// --- shared ---

/** Escape a literal string for safe interpolation into a RegExp (`$&` = the whole match). */
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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
  return new RegExp(`^${escapeRegExp(value)}$`);
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
  return chatGptConversationIdFromUrl(idOrUrl) ?? idOrUrl;
};
