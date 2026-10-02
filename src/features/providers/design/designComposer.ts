import type { Locator, Page } from "playwright";
import { listDesignProjects } from "./designProjects.ts";
import { callDesignRpc, MeReplySchema, OrgSettingsReplySchema } from "./designRpc.ts";
import { DESIGN_SELECTORS, openDesignComposerTab } from "./designTabs.ts";

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

export type DesignSystemChoice = {
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

const MENU_ITEM = '[role="menu"] [role^="menuitem"]';
const SUBMENU_TRIGGERS = /^(Effort|More models)$/i;
const MENU_OPEN_MS = 5_000;
const DESIGN_SYSTEM_LIMIT = 200;

const normalizedLabel = (label: string): string => {
  return label
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9.+]+/gu, " ")
    .trim();
};

const firstLine = (text: string): string => {
  const [line] = text.trim().split("\n");
  if (line === undefined) return "";
  return line.trim();
};

// Exact label first, then prefix, then substring — "haiku" picks "Haiku 4.5".
export const matchDesignLabel = (query: string, labels: readonly string[]): string | undefined => {
  const wanted = normalizedLabel(query);
  if (wanted.length === 0) return undefined;
  const candidates = labels.map((label) => ({ label, key: normalizedLabel(label) }));
  const exact = candidates.find((candidate) => candidate.key === wanted);
  if (exact !== undefined) return exact.label;
  const prefixed = candidates.find((candidate) => candidate.key.startsWith(wanted));
  if (prefixed !== undefined) return prefixed.label;
  return candidates.find((candidate) => candidate.key.includes(wanted))?.label;
};

export const readDesignModels = async (page: Page): Promise<DesignModel[]> => {
  const me = await callDesignRpc({ page, method: "GetMe", body: {}, replySchema: MeReplySchema });
  return me.modelPresets.map((preset) => {
    let label = preset.id;
    if (preset.label !== undefined) label = preset.label;
    const efforts: string[] = [];
    for (const effort of preset.effortOptions) {
      if (effort.name !== undefined) efforts.push(effort.name);
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

export const readDesignSystems = async (page: Page): Promise<DesignSystemChoice[]> => {
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

const menuLabels = async (items: Locator): Promise<string[]> => {
  return (await items.allInnerTexts()).map(firstLine);
};

export const closeDesignMenus = async (page: Page): Promise<void> => {
  for (let press = 0; press < 3; press += 1) {
    if ((await page.locator(DESIGN_SELECTORS.menu).count()) === 0) return;
    await page.keyboard.press("Escape");
  }
};

// The home composer labels its trigger "Model …"; a project composer titles it "Change model".
const modelTrigger = (page: Page): Locator => {
  return page
    .locator('button[title="Change model"]')
    .or(page.getByRole("button", { name: /^Model\b/i }))
    .first();
};

const openModelMenu = async (page: Page): Promise<void> => {
  await closeDesignMenus(page);
  await modelTrigger(page).click();
  await page.locator(MENU_ITEM).first().waitFor({ state: "visible", timeout: MENU_OPEN_MS });
};

// Radix submenus open on hover; click and ArrowRight are the keyboard-safe retries.
const openSubmenu = async (page: Page, name: RegExp): Promise<void> => {
  const menus = page.locator(DESIGN_SELECTORS.menu);
  const submenu = menus.nth(await menus.count());
  const trigger = page.locator(MENU_ITEM).filter({ hasText: name }).first();
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

const clickMatchingItem = async (items: Locator, query: string): Promise<string | undefined> => {
  const labels = await menuLabels(items);
  const choosable = labels.filter((label) => !SUBMENU_TRIGGERS.test(label));
  const label = matchDesignLabel(query, choosable);
  if (label === undefined) return undefined;
  await items.nth(labels.indexOf(label)).click();
  return label;
};

const modelLabelFor = async (page: Page, query: string): Promise<string> => {
  if (!/^claude-/iu.test(query)) return query;
  const models = await readDesignModels(page);
  const preset = models.find((model) => model.id.toLowerCase() === query.toLowerCase());
  if (preset === undefined) return query;
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
  const label = await modelLabelFor(page, query);
  await openModelMenu(page);
  let picked = await clickMatchingItem(page.locator('[role="menuitemradio"]'), label);
  if (picked === undefined) {
    await openSubmenu(page, /^More models/i);
    picked = await clickMatchingItem(page.locator(MENU_ITEM), label);
  }
  if (picked === undefined) {
    const available = (await menuLabels(page.locator(MENU_ITEM))).join(", ");
    await closeDesignMenus(page);
    throw new Error(`Claude Design: no model matches "${query}". Available: ${available}`);
  }
  await closeDesignMenus(page);
  await confirmModelSwitch(page);
};

const pickEffort = async (page: Page, query: string): Promise<void> => {
  await openModelMenu(page);
  const effortTrigger = page.locator(MENU_ITEM).filter({ hasText: /^Effort/i });
  if ((await effortTrigger.count()) === 0) {
    await closeDesignMenus(page);
    throw new Error(`Claude Design: ${await currentDesignModel(page)} has no effort levels.`);
  }
  await openSubmenu(page, /^Effort/i);
  const effortItems = page.locator(DESIGN_SELECTORS.menu).last().locator('[role^="menuitem"]');
  const picked = await clickMatchingItem(effortItems, query);
  if (picked === undefined) {
    const available = (await menuLabels(effortItems)).join(", ");
    await closeDesignMenus(page);
    throw new Error(`Claude Design: no effort matches "${query}". Available: ${available}`);
  }
  await closeDesignMenus(page);
};

export const currentDesignModel = async (page: Page): Promise<string | undefined> => {
  const trigger = modelTrigger(page);
  if ((await trigger.count()) === 0) return undefined;
  const lines = (await trigger.innerText())
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return undefined;
  return lines.join(" · ");
};

export const chooseDesignModel = async (
  page: Page,
  choice: DesignModelChoice,
): Promise<string | undefined> => {
  if (choice.model !== undefined) await pickModel(page, choice.model);
  if (choice.effort !== undefined) await pickEffort(page, choice.effort);
  return currentDesignModel(page);
};

export const chooseDesignTemplate = async (page: Page, query: string): Promise<string> => {
  const template = matchDesignLabel(query, DESIGN_TEMPLATES);
  if (template === undefined) {
    throw new Error(
      `Claude Design: no template matches "${query}". Templates: ${DESIGN_TEMPLATES.join(", ")}`,
    );
  }
  const tiles = page.locator("button[aria-pressed][aria-label]");
  const tileLabels = await tiles.evaluateAll((nodes) =>
    nodes.map((node) => String(node.getAttribute("aria-label"))),
  );
  const tileLabel = matchDesignLabel(template, tileLabels);
  if (tileLabel === undefined) {
    throw new Error(`Claude Design: the "${template}" template is not on the home tray.`);
  }
  const tile = tiles.nth(tileLabels.indexOf(tileLabel));
  if ((await tile.getAttribute("aria-pressed")) !== "true") await tile.click();
  return template;
};

export const attachDesignFiles = async (
  page: Page,
  localPaths: readonly string[],
): Promise<void> => {
  if (localPaths.length === 0) return;
  await closeDesignMenus(page);
  // The import menu holds plain buttons, not menuitems, and there is no file input:
  // the upload only goes through the file chooser that "Attach file" opens.
  let attachButton = page.getByRole("button", { name: /^Attach/i }).first();
  const importButton = page.locator(DESIGN_SELECTORS.importButton);
  if ((await importButton.count()) > 0) {
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
    if (node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement) {
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

const composerText = (composer: Locator): Promise<string> => {
  return composer.evaluate((node) => {
    if (node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement) return node.value;
    return node.textContent === null ? "" : node.textContent;
  });
};

export const typeIntoDesignComposer = async (
  page: Page,
  input: { readonly selector: string; readonly text: string; readonly append: boolean },
): Promise<void> => {
  const composer = page.locator(input.selector).first();
  await composer.click();
  await placeComposerCaret(composer, input.append);
  await page.keyboard.insertText(input.text);
  if (!(await composerText(composer)).includes(input.text)) {
    throw new Error("Claude Design: the composer did not accept the message text.");
  }
};

// Like picking in the UI, the choice also becomes the person's Claude Design default.
export const setDesignModel = async (
  page: Page,
  input: DesignModelChoice & { readonly projectId: string | undefined },
): Promise<{ readonly model: string | undefined }> => {
  const composerTab = await openDesignComposerTab(page, input.projectId);
  return { model: await chooseDesignModel(composerTab, input) };
};
