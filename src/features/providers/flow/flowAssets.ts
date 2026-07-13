import type { Page } from "playwright";

// Asset CRUD for Google Flow projects — the lifecycle operations beyond generating a
// clip: list / download / delete / rename clips, extend a clip into a scene or reuse it
// as a prompt, and list / rename / delete whole projects. These are Flow-specific verbs
// that do NOT belong on the chat-shaped BrowserProvider contract, so they live here as
// plain functions taking a Playwright Page and are surfaced through the flow feature's
// index door (CLI `bridge flow …` + `flow_*` agent tools), not the shared interface.
//
// Selectors were LIVE-VERIFIED (2026-07-13) against a signed-in Flow project editor:
//   - clips are <video> whose src is …/media.getMediaUrlRedirect?name=<uuid> (the id);
//   - each clip tile carries a Material-icon kebab ("more_vert" → "More") that opens a
//     Radix menu with Add to scene / Add to prompt / Download / Rename / Set project
//     cover / Move to trash; the trigger's Radix id is CSS-invalid + unstable, so we tag
//     the right button in-page and click the tag;
//   - menu labels render as icon-ligature + text ("downloadDownload"), so items are
//     matched by an END-ANCHORED label regex (/Download$/) to skip the icon prefix;
//   - the toolbar "More options" menu holds project Rename / View Trash / Delete;
//   - rename opens a dialog with input[aria-label="Editable text"] + a "Done" button.
// Destructive verbs clear through confirmDestructiveDialog so a confirmation step, when
// Flow shows one, is handled; clip delete moves to Flow's (recoverable) Trash.

/** Absolute base for Flow's clip media redirect endpoint. */
const FLOW_CLIP_MEDIA_URL = "https://labs.google/fx/api/trpc/media.getMediaUrlRedirect";

/** Flow project URL fragment used to enumerate projects. */
const PROJECT_LINK_SELECTOR = 'a[href*="/tools/flow/project"]';

/** Rename dialog text field (verified aria-label). */
const RENAME_INPUT_SELECTOR = 'input[aria-label="Editable text"]';

// End-anchored so the leading Material-icon ligature word (e.g. "download") is ignored.
/** Per-clip and project menu item labels, matched against accessible names. */
const MENU_ITEM = {
  addToScene: /Add to scene$/,
  addToPrompt: /Add to prompt$/,
  download: /Download$/,
  rename: /Rename$/,
  moveToTrash: /Move to trash$/,
  deleteProject: /Delete$/,
} as const;

/** Buttons that affirm a destructive confirmation dialog, if Flow shows one. */
const DESTRUCTIVE_CONFIRM = /Move to trash$|Delete$|Remove$|Confirm$|Done$/;

/** Prompt composer (Slate) editor — anchor for ingredient chips attached to the prompt. */
const SLATE_EDITOR_SELECTOR = '[data-slate-editor="true"]';

/** Parents to climb from the Slate editor to reach the container holding ingredient chips. */
const COMPOSER_INGREDIENT_CLIMB = 6;

/** Substring of the alt text Flow gives an attached prompt-ingredient thumbnail. */
const INGREDIENT_ALT_HINT = "in your collection";

/** Material-icon ligature carried by an ingredient chip's remove (×) button. */
const INGREDIENT_REMOVE_LIGATURE = "cancel";

/** A rendered Veo clip in the current Flow project. */
export interface FlowClip {
  /** Stable clip id (the `name` uuid from the media redirect URL). */
  id: string;
  /** Absolute, cookie-fetchable URL that redirects to the clip mp4. */
  url: string;
  /** Zero-based position in the project's clip grid. */
  index: number;
}

/** A reference image attached to the current Flow prompt (an "ingredient"). */
export interface FlowIngredient {
  /** Media id (the `name` uuid from the ingredient thumbnail URL). */
  id: string;
  /** Absolute, cookie-fetchable URL for the ingredient media. */
  url: string;
  /** Zero-based position among the prompt's attached ingredients. */
  index: number;
}

/** A Flow project entry from the sidebar. */
export interface FlowProject {
  /** Project id (last path segment). */
  id: string;
  /** Project display title. */
  title: string;
  /** Absolute project URL. */
  url: string;
}

/**
 * Extract a Flow clip id from a `<video>` src (`…media.getMediaUrlRedirect?name=<uuid>`).
 * Pure so id parsing is unit-testable without a browser.
 *
 * @param src - The raw video/source `src` attribute.
 * @returns The clip id, or an empty string when the src is not a Flow media URL.
 * @example
 * ```ts
 * const id = clipIdFromSrc("/fx/api/trpc/media.getMediaUrlRedirect?name=abc-123");
 * ```
 */
export const clipIdFromSrc = (src: string): string => {
  // raw shape: …media.getMediaUrlRedirect?name=<uuid>[&…] — named capture <clipId>.
  const match = /[?&]name=(?<clipId>[^&#]+)/.exec(src ?? "");
  const raw = match?.groups?.clipId;
  return raw ? decodeURIComponent(raw) : "";
};

/**
 * Build the absolute, cookie-fetchable media URL for a clip id.
 *
 * @param id - Clip id from {@link clipIdFromSrc}.
 * @returns The absolute Flow media redirect URL.
 * @example
 * ```ts
 * const url = clipUrlFromId("abc-123");
 * ```
 */
export const clipUrlFromId = (id: string): string => {
  return `${FLOW_CLIP_MEDIA_URL}?name=${encodeURIComponent(id)}`;
};

/**
 * Extract the Flow project id from a project or in-project scene href. Pure so href
 * parsing is unit-testable without a browser.
 *
 * @param href - A `/tools/flow/project/<id>[/edit/<sceneId>]` href.
 * @returns The project id, or an empty string when the href has no project segment.
 * @example
 * ```ts
 * const id = projectIdFromHref("/fx/tools/flow/project/abc/edit/def");
 * ```
 */
export const projectIdFromHref = (href: string): string => {
  // raw shape: …/tools/flow/project/<projectId>[/edit/<sceneId>] — named capture <projectId>.
  const match = /\/tools\/flow\/project\/(?<projectId>[^/?#]+)/.exec(href ?? "");
  return match?.groups?.projectId ?? "";
};

/**
 * List every rendered clip in the current Flow project, de-duplicated by id.
 *
 * @param page - Playwright page on a Flow project editor.
 * @returns The clips in grid order.
 * @example
 * ```ts
 * const clips = await listClips(page);
 * ```
 */
export const listClips = async (page: Page): Promise<FlowClip[]> => {
  const srcs = await page.evaluate(() =>
    [...document.querySelectorAll("video")].map(
      (v) => v.getAttribute("src") ?? v.querySelector("source")?.getAttribute("src") ?? "",
    ),
  );
  const clips: FlowClip[] = [];
  const seen = new Set<string>();
  srcs.forEach((src, index) => {
    const id = clipIdFromSrc(src);
    if (!id || seen.has(id)) return;
    seen.add(id);
    clips.push({ id, url: clipUrlFromId(id), index });
  });
  return clips;
};

/**
 * Download one clip's mp4 to `outDir` using the page's request context (so the browser's
 * Flow auth cookies ride along). Returns the written file path.
 *
 * @param page - Playwright page on a Flow project (supplies the authed request context).
 * @param clipId - Clip id from {@link listClips}.
 * @param outDir - Directory to write `<clipId>.mp4` into (created if missing).
 * @returns The absolute path of the written file.
 * @example
 * ```ts
 * const file = await downloadClip(page, clip.id, "/tmp/flow");
 * ```
 */
export const downloadClip = async (page: Page, clipId: string, outDir: string): Promise<string> => {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const response = await page.request.get(clipUrlFromId(clipId));
  if (!response.ok()) {
    throw new Error(`Flow clip download failed (${response.status()}) for ${clipId}`);
  }
  const body = await response.body();
  await mkdir(outDir, { recursive: true });
  const dest = join(outDir, `${clipId}.mp4`);
  await writeFile(dest, body);
  return dest;
};

/** Tag the DOM element matching `find` with `attr` so Playwright can click it reliably. */
const tagAndClick = async (input: {
  page: Page;
  attr: string;
  find: string;
}): Promise<void> => {
  const tagged = await input.page.evaluate(
    ({ attr, find }) => {
      const wanted = new RegExp(find, "i");
      // Clip kebab: nearest video whose src carries the id → climb to its tile.
      // Toolbar trigger: first control whose accessible name matches.
      const clipId = attr.startsWith("kebab:") ? attr.slice("kebab:".length) : "";
      const markAttr = clipId ? "data-bridge-kebab" : "data-bridge-more";
      for (const el of document.querySelectorAll(`[${markAttr}]`)) el.removeAttribute(markAttr);
      let root: ParentNode = document;
      if (clipId) {
        const video = [...document.querySelectorAll("video")].find((v) =>
          (v.getAttribute("src") ?? "").includes(clipId),
        );
        if (!video) return false;
        let tile: HTMLElement | null = video;
        for (let up = 0; up < 6 && tile?.parentElement; up += 1) tile = tile.parentElement;
        if (!tile) return false;
        root = tile;
      }
      const control = [...root.querySelectorAll('button, [role="button"]')].find((b) =>
        wanted.test(b.getAttribute("aria-label") ?? b.textContent ?? ""),
      );
      if (!control) return false;
      control.setAttribute(markAttr, "1");
      return true;
    },
    { attr: input.attr, find: input.find },
  );
  if (!tagged) throw new Error(`Flow control not found: ${input.find}`);
  const markAttr = input.attr.startsWith("kebab:") ? "data-bridge-kebab" : "data-bridge-more";
  await input.page.locator(`[${markAttr}="1"]`).click({ timeout: 5_000 });
};

/** Hover a clip tile and open its kebab menu. Throws if the clip id is not present. */
const openClipMenu = async (page: Page, clipId: string): Promise<void> => {
  const video = page.locator(`video[src*="${clipId}"]`).first();
  if ((await video.count()) === 0) throw new Error(`Flow clip not found: ${clipId}`);
  await video.scrollIntoViewIfNeeded().catch(() => {});
  // The kebab is only rendered while the tile is hovered.
  await video.hover().catch(() => {});
  await page.waitForTimeout(400);
  await tagAndClick({ page, attr: `kebab:${clipId}`, find: "more" });
  await page
    .getByRole("menu")
    .first()
    .waitFor({ state: "visible", timeout: 5_000 })
    .catch(() => {});
};

/** Open the toolbar "More options" (project-level) menu. */
const openProjectMenu = async (page: Page): Promise<void> => {
  await tagAndClick({ page, attr: "more", find: "more options" });
  await page
    .getByRole("menu")
    .first()
    .waitFor({ state: "visible", timeout: 5_000 })
    .catch(() => {});
};

/** Click an open menu's item by its end-anchored accessible-name regex. */
const clickMenuItem = async (page: Page, name: RegExp): Promise<void> => {
  await page.getByRole("menuitem", { name }).first().click({ timeout: 5_000 });
};

/** Affirm a destructive confirmation dialog if Flow shows one; no-op otherwise. */
const confirmDestructiveDialog = async (page: Page): Promise<void> => {
  const dialog = page.locator('[role="alertdialog"], [role="dialog"]').first();
  if (!(await dialog.isVisible({ timeout: 1_500 }).catch(() => false))) return;
  const confirm = dialog.getByRole("button", { name: DESTRUCTIVE_CONFIRM }).first();
  if (await confirm.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await confirm.click({ timeout: 5_000 });
  }
};

/**
 * Commit a Flow rename. Live recon (2026-07-13) found the reliable path is the INLINE
 * title field, not the "Rename" dialog:
 *   - the caller opens the kebab → "Rename" first, which selects the target and binds the
 *     inline field to it, but the dialog itself does not save (its "Done" is a no-op) and
 *     while it is open the inline commit is swallowed — so dismiss it with Escape;
 *   - two `input[aria-label="Editable text"]` can exist; the inline one (first in DOM) is
 *     what Flow persists. Clear it with `selectText()` (keyboard select-all was flaky),
 *     type, and commit with Enter. Verified live to survive a page reload.
 */
const submitRenameDialog = async (page: Page, name: string): Promise<void> => {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  const input = page.locator(RENAME_INPUT_SELECTOR).first();
  await input.waitFor({ state: "visible", timeout: 5_000 });
  await input.click();
  await input.selectText();
  await page.keyboard.type(name, { delay: 20 });
  await page.keyboard.press("Enter");
  // Let the save round-trip land before the caller shuts the engine down.
  await page.waitForTimeout(1_000);
};

/**
 * Move a clip to Flow's (recoverable) Trash via its kebab → "Move to trash".
 *
 * @param page - Playwright page on the clip's project.
 * @param clipId - Clip id to delete.
 * @returns Completes once the delete (and any confirmation) is issued.
 * @example
 * ```ts
 * await deleteClip(page, clip.id);
 * ```
 */
export const deleteClip = async (page: Page, clipId: string): Promise<void> => {
  await openClipMenu(page, clipId);
  await clickMenuItem(page, MENU_ITEM.moveToTrash);
  await confirmDestructiveDialog(page);
};

/**
 * Rename a clip via its kebab → "Rename" → dialog.
 *
 * @param page - Playwright page on the clip's project.
 * @param clipId - Clip id to rename.
 * @param name - New clip name.
 * @returns Completes once the rename is confirmed.
 * @example
 * ```ts
 * await renameClip(page, clip.id, "hero shot");
 * ```
 */
export const renameClip = async (page: Page, clipId: string, name: string): Promise<void> => {
  await openClipMenu(page, clipId);
  await clickMenuItem(page, MENU_ITEM.rename);
  await submitRenameDialog(page, name);
};

/**
 * Extend a clip into a scene via its kebab → "Add to scene".
 *
 * @param page - Playwright page on the clip's project.
 * @param clipId - Clip id to extend.
 * @returns Completes once the clip is added to the scene builder.
 * @example
 * ```ts
 * await addClipToScene(page, clip.id);
 * ```
 */
export const addClipToScene = async (page: Page, clipId: string): Promise<void> => {
  await openClipMenu(page, clipId);
  await clickMenuItem(page, MENU_ITEM.addToScene);
};

/**
 * Reuse a clip as generation input via its kebab → "Add to prompt".
 *
 * @param page - Playwright page on the clip's project.
 * @param clipId - Clip id to reuse.
 * @returns Completes once the clip is added to the prompt.
 * @example
 * ```ts
 * await addClipToPrompt(page, clip.id);
 * ```
 */
export const addClipToPrompt = async (page: Page, clipId: string): Promise<void> => {
  await openClipMenu(page, clipId);
  await clickMenuItem(page, MENU_ITEM.addToPrompt);
};

/**
 * List the Flow projects available in the sidebar.
 *
 * @param page - Playwright page on any Flow surface.
 * @returns The projects, de-duplicated by id.
 * @example
 * ```ts
 * const projects = await listFlowProjects(page);
 * ```
 */
export const listFlowProjects = async (page: Page): Promise<FlowProject[]> => {
  const links = await page.locator(PROJECT_LINK_SELECTOR).all();
  const projects: FlowProject[] = [];
  const seen = new Set<string>();
  for (const link of links) {
    const href = await link.getAttribute("href");
    // Dedup by real project id; inside an editor the same project appears once per scene link.
    const id = projectIdFromHref(href ?? "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const title = (await link.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    projects.push({
      id,
      title: title || id,
      url: `https://labs.google/fx/tools/flow/project/${id}`,
    });
  }
  return projects;
};

/**
 * Rename the current project via the toolbar "More options" → "Rename" → dialog.
 *
 * @param page - Playwright page on the project to rename.
 * @param name - New project name.
 * @returns Completes once the rename is confirmed.
 * @example
 * ```ts
 * await renameFlowProject(page, "Launch teaser");
 * ```
 */
export const renameFlowProject = async (page: Page, name: string): Promise<void> => {
  await openProjectMenu(page);
  await clickMenuItem(page, MENU_ITEM.rename);
  await submitRenameDialog(page, name);
};

/**
 * Delete the current project via the toolbar "More options" → "Delete" (confirming the
 * dialog if Flow shows one). Unlike clip delete, project delete is not a Trash move.
 *
 * @param page - Playwright page on the project to delete.
 * @returns Completes once the delete (and any confirmation) is issued.
 * @example
 * ```ts
 * await deleteFlowProject(page);
 * ```
 */
export const deleteFlowProject = async (page: Page): Promise<void> => {
  await openProjectMenu(page);
  await clickMenuItem(page, MENU_ITEM.deleteProject);
  await confirmDestructiveDialog(page);
};

/**
 * List the reference-image ingredients currently attached to the prompt composer,
 * de-duplicated by id. Ingredients render as small `<img>` thumbnails (alt "…in your
 * collection") near the Slate editor, using the same media-redirect URL scheme as clips.
 *
 * @param page - Playwright page on a Flow project editor.
 * @returns The attached ingredients in composer order.
 * @example
 * ```ts
 * const ingredients = await listIngredients(page);
 * ```
 */
export const listIngredients = async (page: Page): Promise<FlowIngredient[]> => {
  const srcs = await page.evaluate(
    ({ editorSelector, climb, altHint }) => {
      const editor = document.querySelector(editorSelector);
      let root: Element | null = editor;
      for (let up = 0; up < climb && root?.parentElement; up += 1) root = root.parentElement;
      if (!root) return [] as string[];
      return [...root.querySelectorAll("img")]
        .filter((img) => (img.getAttribute("alt") ?? "").toLowerCase().includes(altHint))
        .map((img) => img.getAttribute("src") ?? "");
    },
    {
      editorSelector: SLATE_EDITOR_SELECTOR,
      climb: COMPOSER_INGREDIENT_CLIMB,
      altHint: INGREDIENT_ALT_HINT,
    },
  );
  const ingredients: FlowIngredient[] = [];
  const seen = new Set<string>();
  srcs.forEach((src, index) => {
    const id = clipIdFromSrc(src);
    if (!id || seen.has(id)) return;
    seen.add(id);
    ingredients.push({ id, url: clipUrlFromId(id), index });
  });
  return ingredients;
};

/**
 * Remove one attached prompt ingredient by id via its chip's `cancel` (×) button.
 *
 * @param page - Playwright page on a Flow project editor.
 * @param ingredientId - Ingredient id from {@link listIngredients}.
 * @returns Completes once the ingredient chip is removed.
 * @example
 * ```ts
 * await removeIngredient(page, ingredient.id);
 * ```
 */
export const removeIngredient = async (page: Page, ingredientId: string): Promise<void> => {
  const tagged = await page.evaluate(
    ({ editorSelector, climb, altHint, ligature, id }) => {
      const editor = document.querySelector(editorSelector);
      let root: Element | null = editor;
      for (let up = 0; up < climb && root?.parentElement; up += 1) root = root.parentElement;
      if (!root) return false;
      const img = [...root.querySelectorAll("img")].find(
        (candidate) =>
          (candidate.getAttribute("alt") ?? "").toLowerCase().includes(altHint) &&
          (candidate.getAttribute("src") ?? "").includes(id),
      );
      if (!img) return false;
      let tile: Element | null = img;
      for (let up = 0; up < 4 && tile?.parentElement; up += 1) tile = tile.parentElement;
      if (!tile) return false;
      const button = [...tile.querySelectorAll('button, [role="button"]')].find((candidate) =>
        (candidate.textContent ?? "").toLowerCase().includes(ligature),
      );
      if (!button) return false;
      button.setAttribute("data-bridge-ingredient-remove", "1");
      return true;
    },
    {
      editorSelector: SLATE_EDITOR_SELECTOR,
      climb: COMPOSER_INGREDIENT_CLIMB,
      altHint: INGREDIENT_ALT_HINT,
      ligature: INGREDIENT_REMOVE_LIGATURE,
      id: ingredientId,
    },
  );
  if (!tagged) throw new Error(`Flow ingredient not found: ${ingredientId}`);
  await page.locator('[data-bridge-ingredient-remove="1"]').click({ timeout: 5_000 });
};

/**
 * Remove every attached prompt ingredient, re-listing between removals since each one
 * mutates the composer. Returns how many were removed.
 *
 * @param page - Playwright page on a Flow project editor.
 * @returns The number of ingredients removed.
 * @example
 * ```ts
 * const removed = await clearIngredients(page);
 * ```
 */
export const clearIngredients = async (page: Page): Promise<number> => {
  let removed = 0;
  // Cap iterations so an unexpectedly sticky chip can never spin forever.
  for (let guard = 0; guard < 20; guard += 1) {
    const ingredients = await listIngredients(page);
    const first = ingredients[0];
    if (!first) break;
    await removeIngredient(page, first.id);
    removed += 1;
    await page.waitForTimeout(300);
  }
  return removed;
};
