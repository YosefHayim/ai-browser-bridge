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

const FLOW_CLIP_MEDIA_URL = "https://labs.google/fx/api/trpc/media.getMediaUrlRedirect";
const PROJECT_LINK_SELECTOR = 'a[href*="/tools/flow/project"]';
const RENAME_FIELD_SELECTOR = 'input[aria-label="Editable text"]';

// End-anchored so the leading Material-icon ligature word (e.g. "download") is ignored.
const MENU_ELEMENT = {
  addToScene: /Add to scene$/,
  addToPrompt: /Add to prompt$/,
  download: /Download$/,
  rename: /Rename$/,
  moveToTrash: /Move to trash$/,
  deleteProject: /Delete$/,
} as const;

// Raw row example: "Delete" / "Move to trash" confirm label should match.
const DESTRUCTIVE_CONFIRM = /Move to trash$|Delete$|Remove$|Confirm$|Done$/;

const SLATE_EDITOR_SELECTOR = '[data-slate-editor="true"]';
// Climb this many parents from the Slate editor to reach ingredient chips.
const COMPOSER_INGREDIENT_CLIMB = 6;
// Alt text Flow gives an attached prompt-ingredient thumbnail.
const INGREDIENT_ALT_HINT = "in your collection";
// Material-icon ligature on an ingredient chip's remove (×) button.
const INGREDIENT_REMOVE_LIGATURE = "cancel";

export type FlowClip = {
  readonly id: string;
  readonly url: string;
  readonly index: number;
};

export type FlowIngredient = {
  readonly id: string;
  readonly url: string;
  readonly index: number;
};

export type FlowProject = {
  readonly id: string;
  readonly title: string;
  readonly url: string;
};

// Pure so id parsing is unit-testable without a browser.
// raw shape: …media.getMediaUrlRedirect?name=<uuid>[&…] — named capture <clipId>.
export const readClipIdFromUrl = (mediaUrl: string): string => {
  const clipNameHit = /[?&]name=(?<clipId>[^&#]+)/.exec(mediaUrl);

  const unparsedClipId = clipNameHit?.groups?.clipId;
  const isClipIdMissing = unparsedClipId === undefined;
  if (isClipIdMissing) return "";

  return decodeURIComponent(unparsedClipId);
};

export const createClipUrl = (id: string): string => {
  return `${FLOW_CLIP_MEDIA_URL}?name=${encodeURIComponent(id)}`;
};

// Pure so href parsing is unit-testable without a browser.
// raw shape: …/tools/flow/project/<projectId>[/edit/<sceneId>] — named capture <projectId>.
export const readProjectIdFromHref = (href: string): string => {
  const projectPathHit = /\/tools\/flow\/project\/(?<projectId>[^/?#]+)/.exec(href);
  const projectId = projectPathHit?.groups?.projectId;

  const isProjectIdMissing = projectId === undefined;
  if (isProjectIdMissing) return "";

  return projectId;
};

export const listClips = async (page: Page): Promise<FlowClip[]> => {
  const mediaUrls = await page.evaluate(() =>
    [...document.querySelectorAll("video")].map((video) => {
      const videoFileUrl = video.getAttribute("src");

      const hasVideoFileUrl = videoFileUrl !== null;
      if (hasVideoFileUrl) return videoFileUrl;

      const fallbackUrl = video.querySelector("source")?.getAttribute("src");
      const isSrcMissing = fallbackUrl === undefined || fallbackUrl === null;
      if (isSrcMissing) return "";

      return fallbackUrl;
    }),
  );
  const clips: FlowClip[] = [];
  const seen = new Set<string>();
  mediaUrls.forEach((mediaUrl, index) => {
    const id = readClipIdFromUrl(mediaUrl);
    const isIdSkipped = !id || seen.has(id);
    if (isIdSkipped) return;

    seen.add(id);
    clips.push({ id, url: createClipUrl(id), index });
  });
  return clips;
};

// Uses the page request context so Flow auth cookies ride along.
export const downloadClip = async (page: Page, clipId: string, outDir: string): Promise<string> => {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");

  const clipReply = await page.request.get(createClipUrl(clipId));
  const isClipReplyFailed = !clipReply.ok();
  if (isClipReplyFailed) {
    throw new Error(`Flow clip download failed (${clipReply.status()}) for ${clipId}`);
  }

  const clipBytes = await clipReply.body();
  await mkdir(outDir, { recursive: true });
  const dest = join(outDir, `${clipId}.mp4`);
  await writeFile(dest, clipBytes);
  return dest;
};

// Tag a DOM control in-page then click the tag — Radix menu trigger ids are CSS-invalid.
const clickTaggedControl = async (request: {
  page: Page;
  attr: string;
  find: string;
}): Promise<void> => {
  const tagged = await request.page.evaluate(
    ({ attr, find }) => {
      const wanted = new RegExp(find, "i");
      // Clip kebab: nearest video whose src carries the id → climb to its tile.
      // Toolbar trigger: first control whose accessible name matches.
      const isAttrStartsWithKebab = attr.startsWith("kebab:");
      const clipId = isAttrStartsWithKebab ? attr.slice("kebab:".length) : "";
      const markAttr = clipId ? "data-bridge-kebab" : "data-bridge-more";
      for (const element of document.querySelectorAll(`[${markAttr}]`))
        element.removeAttribute(markAttr);
      let root: ParentNode = document;

      if (clipId) {
        const video = [...document.querySelectorAll("video")].find((candidate) => {
          const videoFileUrl = candidate.getAttribute("src");

          const isVideoFileUrlMissing = videoFileUrl === null;
          if (isVideoFileUrlMissing) return false;

          return videoFileUrl.includes(clipId);
        });
        const isVideoMissing = video == null;
        if (isVideoMissing) return false;

        let tile: HTMLElement | null = video;
        for (let up = 0; up < 6 && tile?.parentElement; up += 1) tile = tile.parentElement;

        const isTileMissing = tile == null;
        if (isTileMissing) return false;

        root = tile;
      }

      const control = [...root.querySelectorAll('button, [role="button"]')].find((button) => {
        const ariaLabel = button.getAttribute("aria-label");

        const hasAriaLabel = ariaLabel !== null;
        if (hasAriaLabel) return wanted.test(ariaLabel);

        const buttonLabel = button.textContent;
        const isLabelMissing = buttonLabel === null;
        if (isLabelMissing) return wanted.test("");

        return wanted.test(buttonLabel);
      });
      const isControlMissing = control == null;
      if (isControlMissing) return false;

      control.setAttribute(markAttr, "1");
      return true;
    },
    { attr: request.attr, find: request.find },
  );
  const isNotTagged = !tagged;
  if (isNotTagged) throw new Error(`Flow control not found: ${request.find}`);

  const isAttrStartsWithKebab = request.attr.startsWith("kebab:");
  const markAttr = isAttrStartsWithKebab ? "data-bridge-kebab" : "data-bridge-more";
  await request.page.locator(`[${markAttr}="1"]`).click({ timeout: 5_000 });
};

const openClipMenu = async (page: Page, clipId: string): Promise<void> => {
  const video = page.locator(`video[src*="${clipId}"]`).first();
  const hasNoVideo = (await video.count()) === 0;
  if (hasNoVideo) throw new Error(`Flow clip not found: ${clipId}`);

  await video.scrollIntoViewIfNeeded().catch(() => {});
  // The kebab is only rendered while the tile is hovered.
  await video.hover().catch(() => {});
  await page.waitForTimeout(400);
  await clickTaggedControl({ page, attr: `kebab:${clipId}`, find: "more" });
  await page
    .getByRole("menu")
    .first()
    .waitFor({ state: "visible", timeout: 5_000 })
    .catch(() => {});
};

const openProjectMenu = async (page: Page): Promise<void> => {
  await clickTaggedControl({ page, attr: "more", find: "more options" });
  await page
    .getByRole("menu")
    .first()
    .waitFor({ state: "visible", timeout: 5_000 })
    .catch(() => {});
};

const clickMenuElement = async (page: Page, name: RegExp): Promise<void> => {
  await page.getByRole("menuitem", { name }).first().click({ timeout: 5_000 });
};

const confirmDestructiveDialog = async (page: Page): Promise<void> => {
  const dialog = page.locator('[role="alertdialog"], [role="dialog"]').first();
  const isDialogHidden = !(await dialog.isVisible({ timeout: 1_500 }).catch(() => false));
  if (isDialogHidden) return;

  const confirm = dialog.getByRole("button", { name: DESTRUCTIVE_CONFIRM }).first();
  const isConfirmVisible = await confirm.isVisible({ timeout: 1_000 }).catch(() => false);
  if (isConfirmVisible) {
    await confirm.click({ timeout: 5_000 });
  }
};

// Live recon (2026-07-13): the reliable rename path is the INLINE title field, not the
// "Rename" dialog — its "Done" is a no-op and while open the inline commit is swallowed,
// so dismiss with Escape. Two `input[aria-label="Editable text"]` can exist; the inline
// one (first in DOM) is what Flow persists. Clear with `selectText()` (keyboard select-all
// was flaky), type, and commit with Enter. Verified live to survive a page reload.
const submitRenameDialog = async (page: Page, name: string): Promise<void> => {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  const renameField = page.locator(RENAME_FIELD_SELECTOR).first();
  await renameField.waitFor({ state: "visible", timeout: 5_000 });
  await renameField.click();
  await renameField.selectText();
  await page.keyboard.type(name, { delay: 20 });
  await page.keyboard.press("Enter");
  // Let the save round-trip land before the caller shuts the engine down.
  await page.waitForTimeout(1_000);
};

export const deleteClip = async (page: Page, clipId: string): Promise<void> => {
  await openClipMenu(page, clipId);
  await clickMenuElement(page, MENU_ELEMENT.moveToTrash);
  await confirmDestructiveDialog(page);
};

export const renameClip = async (page: Page, clipId: string, name: string): Promise<void> => {
  await openClipMenu(page, clipId);
  await clickMenuElement(page, MENU_ELEMENT.rename);
  await submitRenameDialog(page, name);
};

export const addClipToScene = async (page: Page, clipId: string): Promise<void> => {
  await openClipMenu(page, clipId);
  await clickMenuElement(page, MENU_ELEMENT.addToScene);
};

export const addClipToPrompt = async (page: Page, clipId: string): Promise<void> => {
  await openClipMenu(page, clipId);
  await clickMenuElement(page, MENU_ELEMENT.addToPrompt);
};

export const listFlowProjects = async (page: Page): Promise<FlowProject[]> => {
  const links = await page.locator(PROJECT_LINK_SELECTOR).all();
  const projects: FlowProject[] = [];
  const seen = new Set<string>();
  for (const link of links) {
    const href = await link.getAttribute("href");

    // Dedup by real project id; inside an editor the same project appears once per scene.
    const isHrefMissing = href === null;
    const id = readProjectIdFromHref(isHrefMissing ? "" : href);
    const isIdSkipped = !id || seen.has(id);
    if (isIdSkipped) continue;

    seen.add(id);
    const linkTitle = await link.innerText().catch(() => "");
    const title = linkTitle.replace(/\s+/g, " ").trim();
    projects.push({
      id,
      title: title || id,
      url: `https://labs.google/fx/tools/flow/project/${id}`,
    });
  }
  return projects;
};

export const renameFlowProject = async (page: Page, name: string): Promise<void> => {
  await openProjectMenu(page);
  await clickMenuElement(page, MENU_ELEMENT.rename);
  await submitRenameDialog(page, name);
};

// Unlike clip delete, project delete is not a Trash move.
export const deleteFlowProject = async (page: Page): Promise<void> => {
  await openProjectMenu(page);
  await clickMenuElement(page, MENU_ELEMENT.deleteProject);
  await confirmDestructiveDialog(page);
};

// Ingredients render as small <img> thumbnails (alt "…in your collection") near the
// Slate editor, using the same media-redirect URL scheme as clips.
export const listIngredients = async (page: Page): Promise<FlowIngredient[]> => {
  const mediaUrls = await page.evaluate(
    ({ editorSelector, climb, altHint }) => {
      const editor = document.querySelector(editorSelector);
      let root: Element | null = editor;
      for (let up = 0; up < climb && root?.parentElement; up += 1) root = root.parentElement;

      const isRootEmpty = !root;
      if (isRootEmpty) return [] as string[];

      return [...root.querySelectorAll("img")]
        .filter((img) => {
          const alt = img.getAttribute("alt");

          const isAltMissing = alt === null;
          if (isAltMissing) return false;

          return alt.toLowerCase().includes(altHint);
        })
        .map((img) => {
          const imageFileUrl = img.getAttribute("src");

          const isImageFileUrlMissing = imageFileUrl === null;
          if (isImageFileUrlMissing) return "";

          return imageFileUrl;
        });
    },
    {
      editorSelector: SLATE_EDITOR_SELECTOR,
      climb: COMPOSER_INGREDIENT_CLIMB,
      altHint: INGREDIENT_ALT_HINT,
    },
  );
  const ingredients: FlowIngredient[] = [];
  const seen = new Set<string>();
  mediaUrls.forEach((mediaUrl, index) => {
    const id = readClipIdFromUrl(mediaUrl);
    const isIdSkipped = !id || seen.has(id);
    if (isIdSkipped) return;

    seen.add(id);
    ingredients.push({ id, url: createClipUrl(id), index });
  });
  return ingredients;
};

export const removeIngredient = async (page: Page, ingredientId: string): Promise<void> => {
  const tagged = await page.evaluate(
    ({ editorSelector, climb, altHint, ligature, id }) => {
      const editor = document.querySelector(editorSelector);
      let root: Element | null = editor;
      for (let up = 0; up < climb && root?.parentElement; up += 1) root = root.parentElement;

      const isRootEmpty = !root;
      if (isRootEmpty) return false;

      const img = [...root.querySelectorAll("img")].find((candidate) => {
        const alt = candidate.getAttribute("alt");

        const imageFileUrl = candidate.getAttribute("src");
        const isImageIncomplete = alt === null || imageFileUrl === null;
        if (isImageIncomplete) return false;

        return alt.toLowerCase().includes(altHint) && imageFileUrl.includes(id);
      });
      const isImgMissing = img == null;
      if (isImgMissing) return false;

      let tile: Element | null = img;
      for (let up = 0; up < 4 && tile?.parentElement; up += 1) tile = tile.parentElement;

      const isTileMissing = tile == null;
      if (isTileMissing) return false;

      const button = [...tile.querySelectorAll('button, [role="button"]')].find((candidate) => {
        const candidateLabel = candidate.textContent;
        const isLabelMissing = candidateLabel === null;
        if (isLabelMissing) return false;

        return candidateLabel.toLowerCase().includes(ligature);
      });
      const isButtonMissing = button == null;
      if (isButtonMissing) return false;

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
  const isNotTagged = !tagged;
  if (isNotTagged) throw new Error(`Flow ingredient not found: ${ingredientId}`);

  await page.locator('[data-bridge-ingredient-remove="1"]').click({ timeout: 5_000 });
};

// Re-list between removals since each mutates the composer. Cap iterations so a sticky
// chip can never spin forever.
export const clearIngredients = async (page: Page): Promise<number> => {
  let removed = 0;
  for (let guard = 0; guard < 20; guard += 1) {
    const ingredients = await listIngredients(page);

    const first = ingredients[0];
    const isFirstEmpty = !first;
    if (isFirstEmpty) break;

    await removeIngredient(page, first.id);
    removed += 1;
    await page.waitForTimeout(300);
  }
  return removed;
};
