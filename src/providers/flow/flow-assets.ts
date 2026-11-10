import type { Page } from "playwright";
import { probeOrFallback, readVisibleCopy } from "@/providers/browser-provider.ts";

const ALT_ATTRIBUTE = "alt";

const IMG_TAG = "img";

const VISIBLE_WAIT_MODE = "visible";

const MENU_ROLE = "menu";

const MORE_LABEL = "more";

const BUTTON_OR_ROLE_BUTTON_SELECTOR = 'button, [role="button"]';

const MORE_ATTRIBUTE = "data-bridge-more";

const KEBAB_ATTRIBUTE = "data-bridge-kebab";

const KEBAB_ATTRIBUTE_PREFIX = "kebab:";

const SRC_ATTRIBUTE = "src";

const VIDEO_TAG = "video";

const MENU_SETTLE_MILLISECONDS = 400;

const CONTROL_WAIT_TIMEOUT_MILLISECONDS = 5_000;

// End-anchored so the leading Material-icon ligature word (e.g. "download") is ignored.
const MENU_ELEMENT = {
  addToScene: /Add to scene$/,
  addToPrompt: /Add to prompt$/,
  download: /Download$/,
  rename: /Rename$/,
  moveToTrash: /Move to trash$/,
  deleteProject: /Delete$/,
} as const;

const SLATE_EDITOR_SELECTOR = '[data-slate-editor="true"]';
// Climb this many parents from the Slate editor to reach ingredient chips.
const COMPOSER_INGREDIENT_CLIMB = 6;
// Alt text Flow gives an attached prompt-ingredient thumbnail.
const INGREDIENT_ALT_HINT = "in your collection";

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

export const readClipIdFromUrl = (mediaUrl: string): string => {
  const clipNameParts = /[?&]name=(?<clipId>[^&#]+)/.exec(mediaUrl);

  const unparsedClipId = clipNameParts?.groups?.clipId;

  const isClipIdMissing = unparsedClipId == null;
  if (isClipIdMissing) return "";

  return decodeURIComponent(unparsedClipId);
};

export const createClipUrl = (id: string): string => {
  return `${"https://labs.google/fx/api/trpc/media.getMediaUrlRedirect"}?name=${encodeURIComponent(id)}`;
};

export const readProjectIdFromHref = (href: string): string => {
  const projectPathParts = /\/tools\/flow\/project\/(?<projectId>[^/?#]+)/.exec(href);
  const projectId = projectPathParts?.groups?.projectId;

  const isProjectIdMissing = projectId == null;
  if (isProjectIdMissing) return "";

  return projectId;
};

export const listClips = async (page: Page): Promise<FlowClip[]> => {
  const mediaUrls = await page.evaluate(() =>
    [...document.querySelectorAll(VIDEO_TAG)].map((video) => {
      const videoFileUrl = video.getAttribute(SRC_ATTRIBUTE);

      const hasVideoFileUrl = videoFileUrl !== null;
      if (hasVideoFileUrl) return videoFileUrl;

      const fallbackUrl = video.querySelector("source")?.getAttribute(SRC_ATTRIBUTE);

      const isSrcMissing = fallbackUrl == null || fallbackUrl === null;
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

  const clipUrl = createClipUrl(clipId);
  const clipReply = await page.request.get(clipUrl);

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
      const isAttrStartsWithKebab = attr.startsWith(KEBAB_ATTRIBUTE_PREFIX);
      const clipId = isAttrStartsWithKebab ? attr.slice(KEBAB_ATTRIBUTE_PREFIX.length) : "";
      const markAttr = clipId ? KEBAB_ATTRIBUTE : MORE_ATTRIBUTE;
      for (const element of document.querySelectorAll(`[${markAttr}]`))
        element.removeAttribute(markAttr);
      let root: ParentNode = document;

      if (clipId) {
        const video = [...document.querySelectorAll(VIDEO_TAG)].find((candidate) => {
          const videoFileUrl = candidate.getAttribute(SRC_ATTRIBUTE);

          const isVideoFileUrlMissing = videoFileUrl === null;
          if (isVideoFileUrlMissing) return false;

          return videoFileUrl.includes(clipId);
        });

        const isVideoMissing = video == null;
        if (isVideoMissing) return false;

        let tile: HTMLElement | null = video;
        const maxParentClimbs = 6;

        for (
          let climbedLevels = 0;
          climbedLevels < maxParentClimbs && tile?.parentElement;
          climbedLevels += 1
        )
          tile = tile.parentElement;

        const isTileMissing = tile == null;
        if (isTileMissing) return false;

        root = tile;
      }

      const control = [...root.querySelectorAll(BUTTON_OR_ROLE_BUTTON_SELECTOR)].find((button) => {
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

  const isAttrStartsWithKebab = request.attr.startsWith(KEBAB_ATTRIBUTE_PREFIX);
  const markAttr = isAttrStartsWithKebab ? KEBAB_ATTRIBUTE : MORE_ATTRIBUTE;
  await request.page
    .locator(`[${markAttr}="1"]`)
    .click({ timeout: CONTROL_WAIT_TIMEOUT_MILLISECONDS });
};

const openClipMenu = async (page: Page, clipId: string): Promise<void> => {
  const video = page.locator(`video[src*="${clipId}"]`).first();
  const videoCount = await video.count();

  const hasNoVideo = videoCount === 0;
  if (hasNoVideo) throw new Error(`Flow clip not found: ${clipId}`);

  await probeOrFallback(null, () => video.scrollIntoViewIfNeeded());
  // The kebab is only rendered while the tile is hovered.
  await probeOrFallback(null, () => video.hover());
  await page.waitForTimeout(MENU_SETTLE_MILLISECONDS);
  await clickTaggedControl({ page, attr: `kebab:${clipId}`, find: MORE_LABEL });
  await probeOrFallback(null, () =>
    page
      .getByRole(MENU_ROLE)
      .first()
      .waitFor({ state: VISIBLE_WAIT_MODE, timeout: CONTROL_WAIT_TIMEOUT_MILLISECONDS }),
  );
};

const openProjectMenu = async (page: Page): Promise<void> => {
  await clickTaggedControl({ page, attr: MORE_LABEL, find: "more options" });
  await probeOrFallback(null, () =>
    page
      .getByRole(MENU_ROLE)
      .first()
      .waitFor({ state: VISIBLE_WAIT_MODE, timeout: CONTROL_WAIT_TIMEOUT_MILLISECONDS }),
  );
};

const clickMenuElement = async (page: Page, name: RegExp): Promise<void> => {
  await page
    .getByRole("menuitem", { name })
    .first()
    .click({ timeout: CONTROL_WAIT_TIMEOUT_MILLISECONDS });
};

const confirmDestructiveDialog = async (page: Page): Promise<void> => {
  const dialog = page.locator('[role="alertdialog"], [role="dialog"]').first();
  const dialogVisibilityTimeoutMilliseconds = 1_500;

  const dialogVisible = await probeOrFallback(false, () =>
    dialog.isVisible({ timeout: dialogVisibilityTimeoutMilliseconds }),
  );

  const isDialogHidden = !dialogVisible;
  if (isDialogHidden) return;

  const confirm = dialog
    .getByRole("button", { name: /Move to trash$|Delete$|Remove$|Confirm$|Done$/ })
    .first();
  const confirmVisibilityTimeoutMilliseconds = 1_000;

  const isConfirmVisible = await probeOrFallback(false, () =>
    confirm.isVisible({ timeout: confirmVisibilityTimeoutMilliseconds }),
  );
  if (isConfirmVisible) {
    await confirm.click({ timeout: CONTROL_WAIT_TIMEOUT_MILLISECONDS });
  }
};

// The inline title field persists; the Rename dialog's Done button does nothing.
const submitRenameDialog = async (page: Page, name: string): Promise<void> => {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(MENU_SETTLE_MILLISECONDS);
  const renameField = page.locator('input[aria-label="Editable text"]').first();
  await renameField.waitFor({
    state: VISIBLE_WAIT_MODE,
    timeout: CONTROL_WAIT_TIMEOUT_MILLISECONDS,
  });
  await renameField.click();
  await renameField.selectText();
  const typingDelayMilliseconds = 20;

  await page.keyboard.type(name, { delay: typingDelayMilliseconds });
  await page.keyboard.press("Enter");
  // Let the save round-trip land before the caller shuts the engine down.
  const renameSettleMilliseconds = 1_000;

  await page.waitForTimeout(renameSettleMilliseconds);
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
  const links = await page.locator('a[href*="/tools/flow/project"]').all();
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
    const linkTitle = await probeOrFallback("", () => readVisibleCopy(link));
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

// Ingredient thumbnails use the same media-redirect URL scheme as clips.
export const listIngredients = async (page: Page): Promise<FlowIngredient[]> => {
  const mediaUrls = await page.evaluate(
    ({ editorSelector, climb, altHint }) => {
      const climbAncestors = (start: Element | null, climbedLevels = 0): Element | null => {
        const isClimbDone = start == null || climbedLevels >= climb || start.parentElement == null;
        if (isClimbDone) return start;

        return climbAncestors(start.parentElement, climbedLevels + 1);
      };
      const root = climbAncestors(document.querySelector(editorSelector));

      const isRootEmpty = root == null;
      if (isRootEmpty) return [];

      return [...root.querySelectorAll(IMG_TAG)]
        .filter((img) => {
          const alt = img.getAttribute(ALT_ATTRIBUTE);

          const isAltMissing = alt === null;
          if (isAltMissing) return false;

          return alt.toLowerCase().includes(altHint);
        })
        .map((img) => {
          const imageFileUrl = img.getAttribute(SRC_ATTRIBUTE);

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
      const climbAncestors = (start: Element | null, climbedLevels = 0): Element | null => {
        const isClimbDone = start == null || climbedLevels >= climb || start.parentElement == null;
        if (isClimbDone) return start;

        return climbAncestors(start.parentElement, climbedLevels + 1);
      };
      const root = climbAncestors(document.querySelector(editorSelector));

      const isRootEmpty = root == null;
      if (isRootEmpty) return false;

      const img = [...root.querySelectorAll(IMG_TAG)].find((candidate) => {
        const alt = candidate.getAttribute(ALT_ATTRIBUTE);

        const imageFileUrl = candidate.getAttribute(SRC_ATTRIBUTE);

        const isImageIncomplete = alt === null || imageFileUrl === null;
        if (isImageIncomplete) return false;

        return alt.toLowerCase().includes(altHint) && imageFileUrl.includes(id);
      });

      const isImgMissing = img == null;
      if (isImgMissing) return false;

      let tile: Element | null = img;
      const maxTileParentClimbs = 4;

      for (
        let climbedLevels = 0;
        climbedLevels < maxTileParentClimbs && tile?.parentElement;
        climbedLevels += 1
      )
        tile = tile.parentElement;

      const isTileMissing = tile == null;
      if (isTileMissing) return false;

      const button = [...tile.querySelectorAll(BUTTON_OR_ROLE_BUTTON_SELECTOR)].find(
        (candidate) => {
          const candidateLabel = candidate.textContent;

          const isLabelMissing = candidateLabel === null;
          if (isLabelMissing) return false;

          return candidateLabel.toLowerCase().includes(ligature);
        },
      );

      const isButtonMissing = button == null;
      if (isButtonMissing) return false;

      button.setAttribute("data-bridge-ingredient-remove", "1");
      return true;
    },
    {
      editorSelector: SLATE_EDITOR_SELECTOR,
      climb: COMPOSER_INGREDIENT_CLIMB,
      altHint: INGREDIENT_ALT_HINT,
      ligature: "cancel",
      id: ingredientId,
    },
  );

  const isNotTagged = !tagged;
  if (isNotTagged) throw new Error(`Flow ingredient not found: ${ingredientId}`);

  await page
    .locator('[data-bridge-ingredient-remove="1"]')
    .click({ timeout: CONTROL_WAIT_TIMEOUT_MILLISECONDS });
};

// Re-list after each removal, since each mutates the composer; the cap stops a sticky chip looping.
export const clearIngredients = async (page: Page): Promise<number> => {
  let removed = 0;
  const maxClearIngredientPasses = 20;

  for (let guard = 0; guard < maxClearIngredientPasses; guard += 1) {
    const ingredients = await listIngredients(page);

    const first = ingredients[0];

    const isFirstEmpty = !first;
    if (isFirstEmpty) break;

    await removeIngredient(page, first.id);
    removed += 1;
    const clearIngredientSettleMilliseconds = 300;

    await page.waitForTimeout(clearIngredientSettleMilliseconds);
  }
  return removed;
};
