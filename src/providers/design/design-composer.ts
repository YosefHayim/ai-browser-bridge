import type { Locator, Page } from "playwright";
import { DesignProjects } from "@/providers/design/design-projects.ts";
import {
  callDesignRpc,
  MeReplySchema,
  OrgSettingsReplySchema,
} from "@/providers/design/design-rpc.ts";
import { DESIGN_SELECTORS, DesignTabs } from "@/providers/design/design-tabs.ts";
import { probeOrFallback, readVisibleCopy } from "@/providers/engine/browser-provider.ts";
import { readFirstLine, VISIBLE_WAIT_MODE } from "@/providers/engine/page-probes.ts";

const LIST_SEPARATOR = ", ";

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

function readLabelKey(label: string): string {
  return label
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9.+]+/gu, " ")
    .trim();
}

// Exact label first, then prefix, then substring — "haiku" picks "Haiku 4.5".
export function findDesignLabel(query: string, labels: readonly string[]): string | null {
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
}

export class DesignComposer {
  constructor(
    private readonly page: Page,
    private readonly tabs = new DesignTabs(page),
    private readonly projects = new DesignProjects(page),
  ) {}

  readDesignModels = async (): Promise<DesignModel[]> => {
    const me = await callDesignRpc({
      page: this.page,
      method: "GetMe",
      body: {},
      replySchema: MeReplySchema,
    });
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

  private readDesignSystems = async (): Promise<DesignSystemChoice[]> => {
    const [designSystemProjects, orgSettings] = await Promise.all([
      this.projects.listDesignProjects({ kind: "design-systems", limit: DESIGN_SYSTEM_LIMIT }),
      callDesignRpc({
        page: this.page,
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

  readDesignCatalog = async (): Promise<DesignCatalog> => {
    const [models, designSystems] = await Promise.all([
      this.readDesignModels(),
      this.readDesignSystems(),
    ]);
    return { templates: DESIGN_TEMPLATES, models, designSystems };
  };

  closeDesignMenus = async (): Promise<void> => {
    const maxAttempts = 3;

    for (let press = 0; press < maxAttempts; press += 1) {
      const isMenuMissing = (await this.page.locator(DESIGN_SELECTORS.menu).count()) === 0;
      if (isMenuMissing) return;

      await this.page.keyboard.press("Escape");
    }
  };

  // The home composer labels its trigger "Model …"; a project composer titles it "Change model".
  private readModelTrigger = (): Locator => {
    return this.page
      .locator('button[title="Change model"]')
      .or(this.page.getByRole(BUTTON_TAG, { name: /^Model\b/i }))
      .first();
  };

  private openModelMenu = async (): Promise<void> => {
    await this.closeDesignMenus();
    await this.readModelTrigger().click();
    await this.page
      .locator(MENU_ELEMENT)
      .first()
      .waitFor({ state: VISIBLE_WAIT_MODE, timeout: MENU_OPEN_MILLISECONDS });
  };

  // Radix submenus open on hover; click and ArrowRight are the keyboard-safe retries.
  private openSubmenu = async (name: RegExp): Promise<void> => {
    const menus = this.page.locator(DESIGN_SELECTORS.menu);
    const submenu = menus.nth(await menus.count());
    const trigger = this.page.locator(MENU_ELEMENT).filter({ hasText: name }).first();
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

  private readModelLabel = async (query: string): Promise<string> => {
    const isNotClaudeModel = !/^claude-/iu.test(query);
    if (isNotClaudeModel) return query;

    const models = await this.readDesignModels();
    const preset = models.find((model) => model.id.toLowerCase() === query.toLowerCase());

    const isPresetMissing = preset == null;
    if (isPresetMissing) return query;

    return preset.label;
  };

  // Switching model inside a running Conversation asks for confirmation first.
  private confirmModelSwitch = async (): Promise<void> => {
    const confirm = this.page.locator('[data-testid="confirm-dialog-confirm"]');

    const isConfirmVisible = await probeOrFallback(false, async () => {
      await confirm.waitFor({ state: VISIBLE_WAIT_MODE, timeout: MENU_WAIT_TIMEOUT_MILLISECONDS });
      return true;
    });

    if (isConfirmVisible) await confirm.click();
  };

  private pickModel = async (query: string): Promise<void> => {
    const label = await this.readModelLabel(query);
    await this.openModelMenu();
    const menuOptionLocator = this.page.locator('[role="menuitemradio"]');
    let picked = await clickMatchingElement(menuOptionLocator, label);

    const isPickedMissing = picked == null;
    if (isPickedMissing) {
      await this.openSubmenu(/^More models/i);
      const menuLocator = this.page.locator(MENU_ELEMENT);
      picked = await clickMatchingElement(menuLocator, label);
    }

    const isPickedStillMissing = picked == null;

    if (isPickedStillMissing) {
      const menuLocator = this.page.locator(MENU_ELEMENT);
      const availableLabels = (await listMenuLabels(menuLocator)).join(LIST_SEPARATOR);
      await this.closeDesignMenus();
      throw new Error(`Claude Design: no model matches "${query}". Available: ${availableLabels}`);
    }

    await this.closeDesignMenus();
    await this.confirmModelSwitch();
  };

  private pickEffort = async (query: string): Promise<void> => {
    await this.openModelMenu();

    const effortTrigger = this.page.locator(MENU_ELEMENT).filter({ hasText: /^Effort/i });
    const effortTriggerCount = await effortTrigger.count();

    const isEffortTriggerMissing = effortTriggerCount === 0;
    if (isEffortTriggerMissing) {
      await this.closeDesignMenus();
      throw new Error(
        `Claude Design: ${await this.readCurrentDesignModel()} has no effort levels.`,
      );
    }

    await this.openSubmenu(/^Effort/i);
    const effortElements = this.page
      .locator(DESIGN_SELECTORS.menu)
      .last()
      .locator('[role^="menuitem"]');
    const picked = await clickMatchingElement(effortElements, query);

    const isPickedMissing = picked == null;
    if (isPickedMissing) {
      const availableLabels = (await listMenuLabels(effortElements)).join(LIST_SEPARATOR);
      await this.closeDesignMenus();
      throw new Error(`Claude Design: no effort matches "${query}". Available: ${availableLabels}`);
    }

    await this.closeDesignMenus();
  };

  readCurrentDesignModel = async (): Promise<string | undefined> => {
    const trigger = this.readModelTrigger();
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

  chooseDesignModel = async (choice: DesignModelChoice): Promise<string | undefined> => {
    const hasChoiceModel = choice.model != null;
    if (hasChoiceModel) await this.pickModel(choice.model);

    const hasChoiceEffort = choice.effort != null;
    if (hasChoiceEffort) await this.pickEffort(choice.effort);

    return this.readCurrentDesignModel();
  };

  chooseDesignTemplate = async (query: string): Promise<string> => {
    const template = findDesignLabel(query, DESIGN_TEMPLATES);

    const isTemplateMissing = template == null;
    if (isTemplateMissing) {
      throw new Error(
        `Claude Design: no template matches "${query}". Templates: ${DESIGN_TEMPLATES.join(LIST_SEPARATOR)}`,
      );
    }

    const tiles = this.page.locator("button[aria-pressed][aria-label]");
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

  attachDesignFiles = async (localPaths: readonly string[]): Promise<void> => {
    const isLocalPathsEmpty = localPaths.length === 0;
    if (isLocalPathsEmpty) return;

    await this.closeDesignMenus();
    // The import menu has no file input; the upload goes through the Attach file chooser.
    let attachButton = this.page.getByRole(BUTTON_TAG, { name: /^Attach/i }).first();

    const importButton = this.page.locator(DESIGN_SELECTORS.importButton);
    const importButtonCount = await importButton.count();

    const hasImportButton = importButtonCount > 0;
    if (hasImportButton) {
      await importButton.first().click();
      attachButton = this.page
        .locator(`${DESIGN_SELECTORS.menu} button`)
        .filter({ hasText: "Attach file" })
        .first();
    }

    try {
      const fileChooserTimeoutMilliseconds = 10_000;

      const [chooser] = await Promise.all([
        this.page.waitForEvent("filechooser", { timeout: fileChooserTimeoutMilliseconds }),
        attachButton.click({ timeout: MENU_OPEN_MILLISECONDS }),
      ]);
      await chooser.setFiles([...localPaths]);
    } finally {
      await this.closeDesignMenus();
    }
  };

  typeIntoDesignComposer = async (request: {
    readonly selector: string;
    readonly text: string;
    readonly append: boolean;
  }): Promise<void> => {
    const composer = this.page.locator(request.selector).first();
    await composer.click();
    await placeComposerCaret(composer, request.append);
    await this.page.keyboard.insertText(request.text);

    const isPromptMissingFromComposer = !(await readComposerDraft(composer)).includes(request.text);
    if (isPromptMissingFromComposer) {
      throw new Error("Claude Design: the composer did not accept the message text.");
    }
  };

  // Like picking in the UI, the choice also becomes the person's Claude Design default.
  setDesignModel = async (
    request: DesignModelChoice & { readonly projectId: string | undefined },
  ): Promise<{ readonly model: string | undefined }> => {
    const composerTab = await this.tabs.openDesignComposerTab(request.projectId);
    return { model: await new DesignComposer(composerTab).chooseDesignModel(request) };
  };
}

async function listMenuLabels(elements: Locator): Promise<string[]> {
  const elementsTexts = await elements.allInnerTexts();
  return elementsTexts.map(readFirstLine);
}

async function isVisibleWithin(locator: Locator, timeoutMilliseconds: number): Promise<boolean> {
  return probeOrFallback(false, async () => {
    await locator.waitFor({ state: VISIBLE_WAIT_MODE, timeout: timeoutMilliseconds });
    return true;
  });
}

async function clickMatchingElement(elements: Locator, query: string): Promise<string | undefined> {
  const labels = await listMenuLabels(elements);
  const choosable = labels.filter((label) => !/^(Effort|More models)$/i.test(label));
  const label = findDesignLabel(query, choosable);

  const isLabelMissing = label == null;
  if (isLabelMissing) return undefined;

  const labelIndex = labels.indexOf(label);
  await elements.nth(labelIndex).click();
  return label;
}

// Replaces the composer text, or puts the caret after it, for a textarea or contenteditable.
function placeComposerCaret(composer: Locator, append: boolean): Promise<void> {
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
}

function readComposerDraft(composer: Locator): Promise<string> {
  return composer.evaluate((node) => {
    const isFormField = node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement;
    if (isFormField) return node.value;

    return node.textContent ?? "";
  });
}
