import type { Locator, Page } from "playwright";
import { probeOrFallback, readVisibleCopy } from "@/providers/browser-provider.ts";
import { listDesignProjects } from "./design-projects.ts";
import { callDesignRpc, MeReplySchema, OrgSettingsReplySchema } from "./design-rpc.ts";
import { DESIGN_SELECTORS, openDesignComposerTab } from "./design-tabs.ts";

const LIST_SEPARATOR = ", ";

const VISIBLE_WAIT_MODE = "visible";

const BUTTON_TAG = "button";

const NEWLINE = "\n";

const MENU_WAIT_TIMEOUT_MILLISECONDS = 1_500;

export const DESIGN_TEMPLATES = [
  "Blank",
  "Mobile app design",
  "Slides",
  "Document",
  "Wireframe",
  "Animation",
  "UI mockups",
  "Résumé",
  "3D object",
  "Research",
  "HTML email",
  "Color + type pairing",
  "Diagram",
  "Flier",
] as const;

export type DesignModel = {
  readonly id: string;
  readonly label: string;
  readonly description: string | undefined;
  readonly efforts: readonly string[];
  readonly isDefault: boolean;
};

type DesignSystemChoice = {
  readonly id: string;
  readonly name: string;
  readonly isOrgDefault: boolean;
};

export type DesignCatalog = {
  readonly templates: readonly string[];
  readonly models: readonly DesignModel[];
  readonly designSystems: readonly DesignSystemChoice[];
};

export type DesignModelChoice = {
  readonly model?: string | undefined;
  readonly effort?: string | undefined;
};

const MENU_ELEMENT = '[role="menu"] [role^="menuitem"]';
const MENU_OPEN_MILLISECONDS = 5_000;
const DESIGN_SYSTEM_LIMIT = 200;

const readLabelKey = (label: string): string => {
  return label
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9.+]+/gu, " ")
    .trim();
};

const readFirstLine = (lines: string): string => {
  const [line] = lines.trim().split(NEWLINE);

  const isLineMissing = line == null;
  if (isLineMissing) return "";

  return line.trim();
};

// Exact label first, then prefix, then substring — "haiku" picks "Haiku 4.5".
export const findDesignLabel = (query: string, labels: readonly string[]): string | null => {
  const wanted = readLabelKey(query);

  const isWantedEmpty = wanted.length === 0;
  if (isWantedEmpty) return null;

  const candidates = labels.map((label) => ({ label, key: readLabelKey(label) }));
  const exact = candidates.find((candidate) => candidate.key === wanted);

  const hasExact = exact != null;
  if (hasExact) return exact.label;

  const prefixed = candidates.find((candidate) => candidate.key.startsWith(wanted));

  const hasPrefixed = prefixed != null;
  if (hasPrefixed) return prefixed.label;

  return candidates.find((candidate) => candidate.key.includes(wanted))?.label ?? null;
};

export const readDesignModels = async (page: Page): Promise<DesignModel[]> => {
  const me = await callDesignRpc({ page, method: "GetMe", body: {}, replySchema: MeReplySchema });
  return me.modelPresets.map((preset) => {
    const label = preset.label ?? preset.id;

    const efforts: string[] = [];
    for (const effort of preset.effortOptions) {
      const effortName = effort.name;

      const hasEffortName = effortName != null;
      if (hasEffortName) efforts.push(effortName);
    }
    return {
      id: preset.id,
      label,
      description: preset.description,
      efforts,
      isDefault: preset.id === me.defaultModelId,
    };
  });
};

const readDesignSystems = async (page: Page): Promise<DesignSystemChoice[]> => {
  const [designSystemProjects, orgSettings] = await Promise.all([
    listDesignProjects(page, { kind: "design-systems", limit: DESIGN_SYSTEM_LIMIT }),
    callDesignRpc({
      page,
      method: "GetOrgSettings",
      body: {},
      replySchema: OrgSettingsReplySchema,
    }),
  ]);

  return designSystemProjects.map((project) => ({
    id: project.id,
    name: project.name,
    isOrgDefault: project.id === orgSettings.defaultDesignSystemProjectUuid,
  }));
};

export const readDesignCatalog = async (page: Page): Promise<DesignCatalog> => {
  const [models, designSystems] = await Promise.all([
    readDesignModels(page),
    readDesignSystems(page),
  ]);
  return { templates: DESIGN_TEMPLATES, models, designSystems };
};

const listMenuLabels = async (elements: Locator): Promise<string[]> => {
  const elementsTexts = await elements.allInnerTexts();
  return elementsTexts.map(readFirstLine);
};

export const closeDesignMenus = async (page: Page): Promise<void> => {
  const maxAttempts = 3;

  for (let press = 0; press < maxAttempts; press += 1) {
    const isMenuMissing = (await page.locator(DESIGN_SELECTORS.menu).count()) === 0;
    if (isMenuMissing) return;

    await page.keyboard.press("Escape");
  }
};

// The home composer labels its trigger "Model …"; a project composer titles it "Change model".
const readModelTrigger = (page: Page): Locator => {
  return page
    .locator('button[title="Change model"]')
    .or(page.getByRole(BUTTON_TAG, { name: /^Model\b/i }))
    .first();
};

const openModelMenu = async (page: Page): Promise<void> => {
  await closeDesignMenus(page);
  await readModelTrigger(page).click();
  await page
    .locator(MENU_ELEMENT)
    .first()
    .waitFor({ state: VISIBLE_WAIT_MODE, timeout: MENU_OPEN_MILLISECONDS });
};

const isVisibleWithin = async (locator: Locator, timeoutMilliseconds: number): Promise<boolean> => {
  return probeOrFallback(false, async () => {
    await locator.waitFor({ state: VISIBLE_WAIT_MODE, timeout: timeoutMilliseconds });
    return true;
  });
};

// Radix submenus open on hover; click and ArrowRight are the keyboard-safe retries.
const openSubmenu = async (page: Page, name: RegExp): Promise<void> => {
  const menus = page.locator(DESIGN_SELECTORS.menu);
  const submenu = menus.nth(await menus.count());
  const trigger = page.locator(MENU_ELEMENT).filter({ hasText: name }).first();
  for (const open of [
    () => trigger.hover(),
    () => trigger.click(),
    () => trigger.press("ArrowRight"),
  ]) {
    await open();

    const isSubmenuOpened = await isVisibleWithin(submenu, MENU_WAIT_TIMEOUT_MILLISECONDS);

    if (isSubmenuOpened) return;
  }
  throw new Error(`Claude Design: the ${name.source} submenu did not open.`);
};

const clickMatchingElement = async (
  elements: Locator,
  query: string,
): Promise<string | undefined> => {
  const labels = await listMenuLabels(elements);
  const choosable = labels.filter((label) => !/^(Effort|More models)$/i.test(label));
  const label = findDesignLabel(query, choosable);

  const isLabelMissing = label == null;
  if (isLabelMissing) return undefined;

  const labelIndex = labels.indexOf(label);
  await elements.nth(labelIndex).click();
  return label;
};

const readModelLabel = async (page: Page, query: string): Promise<string> => {
  const isNotClaudeModel = !/^claude-/iu.test(query);
  if (isNotClaudeModel) return query;

  const models = await readDesignModels(page);
  const preset = models.find((model) => model.id.toLowerCase() === query.toLowerCase());

  const isPresetMissing = preset == null;
  if (isPresetMissing) return query;

  return preset.label;
};

// Switching model inside a running Conversation asks for confirmation first.
const confirmModelSwitch = async (page: Page): Promise<void> => {
  const confirm = page.locator('[data-testid="confirm-dialog-confirm"]');

  const isConfirmVisible = await probeOrFallback(false, async () => {
    await confirm.waitFor({ state: VISIBLE_WAIT_MODE, timeout: MENU_WAIT_TIMEOUT_MILLISECONDS });
    return true;
  });

  if (isConfirmVisible) await confirm.click();
};

const pickModel = async (page: Page, query: string): Promise<void> => {
  const label = await readModelLabel(page, query);
  await openModelMenu(page);
  const menuOptionLocator = page.locator('[role="menuitemradio"]');
  let picked = await clickMatchingElement(menuOptionLocator, label);

  const isPickedMissing = picked == null;
  if (isPickedMissing) {
    await openSubmenu(page, /^More models/i);
    const menuLocator = page.locator(MENU_ELEMENT);
    picked = await clickMatchingElement(menuLocator, label);
  }

  const isPickedStillMissing = picked == null;

  if (isPickedStillMissing) {
    const menuLocator = page.locator(MENU_ELEMENT);
    const availableLabels = (await listMenuLabels(menuLocator)).join(LIST_SEPARATOR);
    await closeDesignMenus(page);
    throw new Error(`Claude Design: no model matches "${query}". Available: ${availableLabels}`);
  }

  await closeDesignMenus(page);
  await confirmModelSwitch(page);
};

const pickEffort = async (page: Page, query: string): Promise<void> => {
  await openModelMenu(page);

  const effortTrigger = page.locator(MENU_ELEMENT).filter({ hasText: /^Effort/i });
  const effortTriggerCount = await effortTrigger.count();

  const isEffortTriggerMissing = effortTriggerCount === 0;
  if (isEffortTriggerMissing) {
    await closeDesignMenus(page);
    throw new Error(`Claude Design: ${await readCurrentDesignModel(page)} has no effort levels.`);
  }

  await openSubmenu(page, /^Effort/i);
  const effortElements = page.locator(DESIGN_SELECTORS.menu).last().locator('[role^="menuitem"]');
  const picked = await clickMatchingElement(effortElements, query);

  const isPickedMissing = picked == null;
  if (isPickedMissing) {
    const availableLabels = (await listMenuLabels(effortElements)).join(LIST_SEPARATOR);
    await closeDesignMenus(page);
    throw new Error(`Claude Design: no effort matches "${query}". Available: ${availableLabels}`);
  }

  await closeDesignMenus(page);
};

export const readCurrentDesignModel = async (page: Page): Promise<string | undefined> => {
  const trigger = readModelTrigger(page);
  const triggerCount = await trigger.count();

  const isTriggerMissing = triggerCount === 0;
  if (isTriggerMissing) return undefined;

  const triggerLabel = await readVisibleCopy(trigger);
  const lines = triggerLabel
    .split(NEWLINE)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const isLinesEmpty = lines.length === 0;
  if (isLinesEmpty) return undefined;

  return lines.join(" · ");
};

export const chooseDesignModel = async (
  page: Page,
  choice: DesignModelChoice,
): Promise<string | undefined> => {
  const hasChoiceModel = choice.model != null;
  if (hasChoiceModel) await pickModel(page, choice.model);

  const hasChoiceEffort = choice.effort != null;
  if (hasChoiceEffort) await pickEffort(page, choice.effort);

  return readCurrentDesignModel(page);
};

export const chooseDesignTemplate = async (page: Page, query: string): Promise<string> => {
  const template = findDesignLabel(query, DESIGN_TEMPLATES);

  const isTemplateMissing = template == null;
  if (isTemplateMissing) {
    throw new Error(
      `Claude Design: no template matches "${query}". Templates: ${DESIGN_TEMPLATES.join(LIST_SEPARATOR)}`,
    );
  }

  const tiles = page.locator("button[aria-pressed][aria-label]");
  const tileLabels = await tiles.evaluateAll((nodes) =>
    nodes.map((node) => String(node.getAttribute("aria-label"))),
  );
  const tileLabel = findDesignLabel(template, tileLabels);

  const isTileLabelMissing = tileLabel == null;
  if (isTileLabelMissing) {
    throw new Error(`Claude Design: the "${template}" template is not on the home tray.`);
  }

  const tileLabelIndex = tileLabels.indexOf(tileLabel);
  const tile = tiles.nth(tileLabelIndex);

  const isTileNotPressed = (await tile.getAttribute("aria-pressed")) !== "true";
  if (isTileNotPressed) await tile.click();

  return template;
};

export const attachDesignFiles = async (
  page: Page,
  localPaths: readonly string[],
): Promise<void> => {
  const isLocalPathsEmpty = localPaths.length === 0;
  if (isLocalPathsEmpty) return;

  await closeDesignMenus(page);
  // The import menu has no file input; the upload goes through the Attach file chooser.
  let attachButton = page.getByRole(BUTTON_TAG, { name: /^Attach/i }).first();

  const importButton = page.locator(DESIGN_SELECTORS.importButton);
  const importButtonCount = await importButton.count();

  const hasImportButton = importButtonCount > 0;
  if (hasImportButton) {
    await importButton.first().click();
    attachButton = page
      .locator(`${DESIGN_SELECTORS.menu} button`)
      .filter({ hasText: "Attach file" })
      .first();
  }

  try {
    const fileChooserTimeoutMilliseconds = 10_000;

    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: fileChooserTimeoutMilliseconds }),
      attachButton.click({ timeout: MENU_OPEN_MILLISECONDS }),
    ]);
    await chooser.setFiles([...localPaths]);
  } finally {
    await closeDesignMenus(page);
  }
};

// Replaces the composer text, or puts the caret after it, for a textarea or contenteditable.
const placeComposerCaret = (composer: Locator, append: boolean): Promise<void> => {
  return composer.evaluate((node, isCollapseToEnd) => {
    const isFormField = node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement;
    if (isFormField) {
      const start = isCollapseToEnd ? node.value.length : 0;

      node.setSelectionRange(start, node.value.length);
      return;
    }

    const range = document.createRange();
    range.selectNodeContents(node);

    if (isCollapseToEnd) range.collapse(false);

    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, append);
};

const readComposerDraft = (composer: Locator): Promise<string> => {
  return composer.evaluate((node) => {
    const isFormField = node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement;
    if (isFormField) return node.value;

    return node.textContent ?? "";
  });
};

export const typeIntoDesignComposer = async (
  page: Page,
  request: { readonly selector: string; readonly text: string; readonly append: boolean },
): Promise<void> => {
  const composer = page.locator(request.selector).first();
  await composer.click();
  await placeComposerCaret(composer, request.append);
  await page.keyboard.insertText(request.text);

  const isPromptMissingFromComposer = !(await readComposerDraft(composer)).includes(request.text);
  if (isPromptMissingFromComposer) {
    throw new Error("Claude Design: the composer did not accept the message text.");
  }
};

// Like picking in the UI, the choice also becomes the person's Claude Design default.
export const setDesignModel = async (
  page: Page,
  request: DesignModelChoice & { readonly projectId: string | undefined },
): Promise<{ readonly model: string | undefined }> => {
  const composerTab = await openDesignComposerTab(page, request.projectId);
  return { model: await chooseDesignModel(composerTab, request) };
};
