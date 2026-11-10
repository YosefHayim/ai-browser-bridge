import type { Locator, Page } from "playwright";
import { listDesignProjects } from "./design-projects.ts";
import { callDesignRpc, MeReplySchema, OrgSettingsReplySchema } from "./design-rpc.ts";
import { DESIGN_SELECTORS, openDesignComposerTab } from "./design-tabs.ts";

// The home template tray as of 2026-10-02; the live tray is what a template click matches.
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
const SUBMENU_TRIGGERS = /^(Effort|More models)$/i;
const MENU_OPEN_MS = 5_000;
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
  const [line] = lines.trim().split("\n");

  const isLineMissing = line === undefined;
  if (isLineMissing) return "";

  return line.trim();
};

// Exact label first, then prefix, then substring — "haiku" picks "Haiku 4.5".
export const findDesignLabel = (query: string, labels: readonly string[]): string | undefined => {
  const wanted = readLabelKey(query);

  const isWantedEmpty = wanted.length === 0;
  if (isWantedEmpty) return undefined;

  const candidates = labels.map((label) => ({ label, key: readLabelKey(label) }));
  const exact = candidates.find((candidate) => candidate.key === wanted);

  const hasExact = exact !== undefined;
  if (hasExact) return exact.label;

  const prefixed = candidates.find((candidate) => candidate.key.startsWith(wanted));

  const hasPrefixed = prefixed !== undefined;
  if (hasPrefixed) return prefixed.label;

  return candidates.find((candidate) => candidate.key.includes(wanted))?.label;
};

export const readDesignModels = async (page: Page): Promise<DesignModel[]> => {
  const me = await callDesignRpc({ page, method: "GetMe", body: {}, replySchema: MeReplySchema });
  return me.modelPresets.map((preset) => {
    let label = preset.id;

    const hasPresetLabel = preset.label !== undefined;
    if (hasPresetLabel) label = preset.label;

    const efforts: string[] = [];
    for (const effort of preset.effortOptions) {
      const hasEffortName = effort.name !== undefined;
      if (hasEffortName) efforts.push(effort.name);
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
  return (await elements.allInnerTexts()).map(readFirstLine);
};

export const closeDesignMenus = async (page: Page): Promise<void> => {
  for (let press = 0; press < 3; press += 1) {
    const isMenuMissing = (await page.locator(DESIGN_SELECTORS.menu).count()) === 0;
    if (isMenuMissing) return;

    await page.keyboard.press("Escape");
  }
};

// The home composer labels its trigger "Model …"; a project composer titles it "Change model".
const readModelTrigger = (page: Page): Locator => {
  return page
    .locator('button[title="Change model"]')
    .or(page.getByRole("button", { name: /^Model\b/i }))
    .first();
};

const openModelMenu = async (page: Page): Promise<void> => {
  await closeDesignMenus(page);
  await readModelTrigger(page).click();
  await page.locator(MENU_ELEMENT).first().waitFor({ state: "visible", timeout: MENU_OPEN_MS });
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

    const opened = await submenu.waitFor({ state: "visible", timeout: 1_500 }).then(
      () => true,
      () => false,
    );
    if (opened) return;
  }
  throw new Error(`Claude Design: the ${name.source} submenu did not open.`);
};

const clickMatchingElement = async (
  elements: Locator,
  query: string,
): Promise<string | undefined> => {
  const labels = await listMenuLabels(elements);
  const choosable = labels.filter((label) => !SUBMENU_TRIGGERS.test(label));
  const label = findDesignLabel(query, choosable);

  const isLabelMissing = label === undefined;
  if (isLabelMissing) return undefined;

  await elements.nth(labels.indexOf(label)).click();
  return label;
};

const readModelLabel = async (page: Page, query: string): Promise<string> => {
  const isNotClaudeModel = !/^claude-/iu.test(query);
  if (isNotClaudeModel) return query;

  const models = await readDesignModels(page);
  const preset = models.find((model) => model.id.toLowerCase() === query.toLowerCase());

  const isPresetMissing = preset === undefined;
  if (isPresetMissing) return query;

  return preset.label;
};

// Switching model inside a running Conversation asks for confirmation first.
const confirmModelSwitch = async (page: Page): Promise<void> => {
  const confirm = page.locator('[data-testid="confirm-dialog-confirm"]');
  try {
    await confirm.waitFor({ state: "visible", timeout: 1_500 });
  } catch {
    return;
  }
  await confirm.click();
};

const pickModel = async (page: Page, query: string): Promise<void> => {
  const label = await readModelLabel(page, query);
  await openModelMenu(page);
  let picked = await clickMatchingElement(page.locator('[role="menuitemradio"]'), label);

  const isPickedMissing = picked === undefined;
  if (isPickedMissing) {
    await openSubmenu(page, /^More models/i);
    picked = await clickMatchingElement(page.locator(MENU_ELEMENT), label);
  }

  if (picked === undefined) {
    const availableLabels = (await listMenuLabels(page.locator(MENU_ELEMENT))).join(", ");
    await closeDesignMenus(page);
    throw new Error(`Claude Design: no model matches "${query}". Available: ${availableLabels}`);
  }

  await closeDesignMenus(page);
  await confirmModelSwitch(page);
};

const pickEffort = async (page: Page, query: string): Promise<void> => {
  await openModelMenu(page);

  const effortTrigger = page.locator(MENU_ELEMENT).filter({ hasText: /^Effort/i });
  const isEffortTriggerMissing = (await effortTrigger.count()) === 0;
  if (isEffortTriggerMissing) {
    await closeDesignMenus(page);
    throw new Error(`Claude Design: ${await readCurrentDesignModel(page)} has no effort levels.`);
  }

  await openSubmenu(page, /^Effort/i);
  const effortElements = page.locator(DESIGN_SELECTORS.menu).last().locator('[role^="menuitem"]');
  const picked = await clickMatchingElement(effortElements, query);

  const isPickedMissing = picked === undefined;
  if (isPickedMissing) {
    const availableLabels = (await listMenuLabels(effortElements)).join(", ");
    await closeDesignMenus(page);
    throw new Error(`Claude Design: no effort matches "${query}". Available: ${availableLabels}`);
  }

  await closeDesignMenus(page);
};

export const readCurrentDesignModel = async (page: Page): Promise<string | undefined> => {
  const trigger = readModelTrigger(page);
  const isTriggerMissing = (await trigger.count()) === 0;
  if (isTriggerMissing) return undefined;

  const lines = (await trigger.innerText())
    .split("\n")
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
  const hasChoiceModel = choice.model !== undefined;
  if (hasChoiceModel) await pickModel(page, choice.model);

  const hasChoiceEffort = choice.effort !== undefined;
  if (hasChoiceEffort) await pickEffort(page, choice.effort);

  return readCurrentDesignModel(page);
};

export const chooseDesignTemplate = async (page: Page, query: string): Promise<string> => {
  const template = findDesignLabel(query, DESIGN_TEMPLATES);

  const isTemplateMissing = template === undefined;
  if (isTemplateMissing) {
    throw new Error(
      `Claude Design: no template matches "${query}". Templates: ${DESIGN_TEMPLATES.join(", ")}`,
    );
  }

  const tiles = page.locator("button[aria-pressed][aria-label]");
  const tileLabels = await tiles.evaluateAll((nodes) =>
    nodes.map((node) => String(node.getAttribute("aria-label"))),
  );
  const tileLabel = findDesignLabel(template, tileLabels);

  const isTileLabelMissing = tileLabel === undefined;
  if (isTileLabelMissing) {
    throw new Error(`Claude Design: the "${template}" template is not on the home tray.`);
  }

  const tile = tiles.nth(tileLabels.indexOf(tileLabel));
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
  // The import menu holds plain buttons, not menuitems, and there is no file input:
  // the upload only goes through the file chooser that "Attach file" opens.
  let attachButton = page.getByRole("button", { name: /^Attach/i }).first();

  const importButton = page.locator(DESIGN_SELECTORS.importButton);
  const hasImportButton = (await importButton.count()) > 0;
  if (hasImportButton) {
    await importButton.first().click();
    attachButton = page
      .locator(`${DESIGN_SELECTORS.menu} button`)
      .filter({ hasText: "Attach file" })
      .first();
  }

  try {
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 10_000 }),
      attachButton.click({ timeout: MENU_OPEN_MS }),
    ]);
    await chooser.setFiles([...localPaths]);
  } finally {
    await closeDesignMenus(page);
  }
};

// Selects the composer's text (replace) or puts the caret after it (append), for either a
// textarea or a contenteditable composer.
const placeComposerCaret = (composer: Locator, append: boolean): Promise<void> => {
  return composer.evaluate((node, collapseToEnd) => {
    const isFormField = node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement;
    if (isFormField) {
      let start = 0;

      if (collapseToEnd) start = node.value.length;

      node.setSelectionRange(start, node.value.length);
      return;
    }

    const range = document.createRange();
    range.selectNodeContents(node);

    if (collapseToEnd) range.collapse(false);

    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, append);
};

const readComposerDraft = (composer: Locator): Promise<string> => {
  return composer.evaluate((node) => {
    const isFormField = node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement;
    if (isFormField) return node.value;

    return node.textContent === null ? "" : node.textContent;
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
