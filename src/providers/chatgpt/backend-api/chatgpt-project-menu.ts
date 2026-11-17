import type { Locator, Page } from "playwright";
import {
  CHATGPT_MENU_ITEM,
  ChatGptPageControls,
  isLocatorWaitMet,
  isMenuElementShown,
} from "@/providers/chatgpt/backend-api/chatgpt-page-controls.ts";
import type {
  DeleteProjectVerdict,
  RenameProjectVerdict,
  WorkspaceProject,
} from "@/providers/chatgpt/backend-api/chatgpt-workspace-types.ts";
import { probeOrFallback } from "@/providers/engine/browser-provider.ts";
import { VISIBLE_WAIT_MODE } from "@/providers/engine/page-probes.ts";

const projectsUrl = "https://chatgpt.com/projects";
const sidebarProjects = '[data-testid="sidebar-item-projects"]';
const newProjectButton = 'button[aria-label="Add new project"]';
const projectNameInput = 'input[name="project-name"]';
const projectsPageSettleMilliseconds = 800;
const panelFieldMilliseconds = 8_000;
const savedSettleMilliseconds = 1_200;
const hoverSettleMilliseconds = 200;
const buttonCheckMilliseconds = 2_000;
const menuAttachedMilliseconds = 5_000;
const pointerDownMilliseconds = 2_000;
const menuItemMilliseconds = 4_000;
const retryReloadMilliseconds = 1_000;
const maxMenuAttempts = 3;

export class ChatGptProjectMenu {
  private readonly controls: ChatGptPageControls;

  constructor(private readonly page: Page) {
    this.controls = new ChatGptPageControls(page);
  }

  createProject = async (name: string): Promise<WorkspaceProject> => {
    const trimmed = name.trim();

    const isTrimmedEmpty = !trimmed;
    if (isTrimmedEmpty) throw new Error("Project name is required.");

    await this.openNewProjectPanel();
    const field = this.page.locator(projectNameInput).first();
    await field.waitFor({ state: VISIBLE_WAIT_MODE, timeout: panelFieldMilliseconds });
    await field.fill(trimmed);
    await this.submitCreateProject();
    await this.page.waitForTimeout(savedSettleMilliseconds);
    return { name: trimmed };
  };

  renameProject = async (project: string, name: string): Promise<RenameProjectVerdict> => {
    const base: RenameProjectVerdict = { project, renamedTo: name.trim(), renamed: false };

    const isBaseRenamedToEmpty = !base.renamedTo;
    if (isBaseRenamedToEmpty) return { ...base, reason: "a new name is required" };

    const field = this.page.locator('input[aria-label="Project name"]').first();
    const openResult = await this.openProjectSettings(project, field);

    const isProjectMissing = openResult === "project-missing";
    if (isProjectMissing) return { ...base, reason: `project "${project}" not found` };

    const isFieldNotOpened = openResult === "field-not-opened";
    if (isFieldNotOpened) {
      await this.controls.dismissMenu();
      return { ...base, reason: "the project name field did not open" };
    }

    // Real keystrokes so React's controlled input registers the change.
    await field.click();
    await field.press("ControlOrMeta+a");
    const renameTypingDelayMilliseconds = 15;

    await field.pressSequentially(base.renamedTo, { delay: renameTypingDelayMilliseconds });

    const save = this.page.getByRole("button", { name: "Save", exact: true }).first();
    const saveShownMilliseconds = 2_500;

    const isSaveVisible = await probeOrFallback(false, () =>
      save.isVisible({ timeout: saveShownMilliseconds }),
    );

    const isSaveHidden = !isSaveVisible;
    if (isSaveHidden) {
      await this.controls.dismissMenu();
      return { ...base, reason: "the Save button did not appear after editing the name" };
    }

    await save.click();
    await this.page.waitForTimeout(savedSettleMilliseconds);
    return { ...base, renamed: true };
  };

  deleteProject = async (project: string): Promise<DeleteProjectVerdict> => {
    const base: DeleteProjectVerdict = { project, deleted: false };
    const confirm = this.page
      .getByRole("dialog")
      .getByRole("button", { name: /^Delete/ })
      .first();

    const confirmResult = await this.openDeleteConfirmation(project, confirm);

    const isProjectMissing = confirmResult === "project-missing";
    if (isProjectMissing) return { ...base, reason: `project "${project}" not found` };

    const isConfirmationMissing = confirmResult === "confirmation-missing";
    if (isConfirmationMissing) {
      await this.controls.dismissMenu();
      return { ...base, reason: "the delete confirmation did not appear" };
    }

    await confirm.click();
    await this.page.waitForTimeout(retryReloadMilliseconds);
    return { ...base, deleted: true };
  };

  private openProjectSettings = async (
    project: string,
    field: Locator,
  ): Promise<"opened" | "project-missing" | "field-not-opened"> => {
    for (let attempt = 0; attempt < maxMenuAttempts; attempt += 1) {
      const isRetryAttempt = attempt > 0;
      if (isRetryAttempt) await this.controls.dismissMenu();

      const didProjectMenuOpen = await this.openProjectMenu(project);

      const isProjectMenuNotOpened = !didProjectMenuOpen;
      if (isProjectMenuNotOpened) return "project-missing";

      const settings = this.page.getByRole("menuitem", { name: "Project settings" }).first();
      const isSettingsShown = await isMenuElementShown(settings);

      const isSettingsHidden = !isSettingsShown;
      if (isSettingsHidden) continue;

      await probeOrFallback(null, () => settings.click());
      const fieldShownMilliseconds = 3_500;

      const isFieldShown = await probeOrFallback(false, () =>
        field.isVisible({ timeout: fieldShownMilliseconds }),
      );
      if (isFieldShown) return "opened";
    }
    return "field-not-opened";
  };

  private openDeleteConfirmation = async (
    project: string,
    confirm: Locator,
  ): Promise<"shown" | "project-missing" | "confirmation-missing"> => {
    for (let attempt = 0; attempt < maxMenuAttempts; attempt += 1) {
      const isRetryAttempt = attempt > 0;
      if (isRetryAttempt) await this.controls.dismissMenu();

      const didProjectMenuOpen = await this.openProjectMenu(project);

      const isProjectMenuStillClosed = !didProjectMenuOpen;
      if (isProjectMenuStillClosed) return "project-missing";

      const del = this.page.getByRole("menuitem", { name: "Delete project" }).first();
      const isDeleteShown = await isMenuElementShown(del);

      const isDeleteHidden = !isDeleteShown;
      if (isDeleteHidden) continue;

      await probeOrFallback(null, () => del.click());
      const confirmShownMilliseconds = 5_000;

      const isConfirmShown = await isMenuElementShown(confirm, confirmShownMilliseconds);
      if (isConfirmShown) return "shown";
    }
    return "confirmation-missing";
  };

  private ensureOnProjectsPage = async (): Promise<void> => {
    const isOnProjectsPage = this.page.url().startsWith(projectsUrl);
    if (isOnProjectsPage) return;

    await this.controls.gotoStable(projectsUrl);
    await this.page.waitForTimeout(projectsPageSettleMilliseconds);
  };

  // Overlapping sidebar links intercept coordinate clicks, so dispatch the click on the node.
  private openNewProjectPanel = async (): Promise<void> => {
    await this.ensureOnProjectsPage();
    await probeOrFallback(null, () => this.page.locator(sidebarProjects).first().hover());
    await this.page.waitForTimeout(hoverSettleMilliseconds);

    const button = this.page.locator(newProjectButton).first();

    await button.waitFor({ state: "attached", timeout: panelFieldMilliseconds });
    await button.evaluate((navElement) => {
      const isHtmlElement = navElement instanceof HTMLElement;
      if (isHtmlElement) navElement.click();
    });
  };

  private submitCreateProject = async (): Promise<void> => {
    const button = this.page.getByRole("button", { name: /create project/i }).first();

    const isButtonShown = await probeOrFallback(false, () =>
      button.isVisible({ timeout: buttonCheckMilliseconds }),
    );
    if (isButtonShown) {
      await button.click();
      return;
    }

    await this.page.locator(projectNameInput).first().press("Enter");
  };

  private openProjectMenu = async (project: string): Promise<boolean> => {
    const trigger = this.page
      .getByRole("button", { name: `Project actions for ${project}`, exact: true })
      .first();

    const maxProjectActionsAttempts = 2;
    for (let attempt = 0; attempt < maxProjectActionsAttempts; attempt += 1) {
      await this.loadProjectsPage(attempt);

      const isAttached = await isLocatorWaitMet(trigger, {
        state: "attached",
        timeout: menuAttachedMilliseconds,
      });

      const isNotAttached = !isAttached;
      if (isNotAttached) continue;

      const isMenuShown = await probeOrFallback(false, async () => {
        await probeOrFallback(null, () => trigger.scrollIntoViewIfNeeded());
        await probeOrFallback(null, () =>
          this.controls.firePointerDown(trigger, pointerDownMilliseconds),
        );
        await this.page
          .locator(CHATGPT_MENU_ITEM)
          .first()
          .waitFor({ timeout: menuItemMilliseconds });
        return true;
      });
      if (isMenuShown) return true;

      await this.controls.dismissMenu();
    }
    return false;
  };

  private loadProjectsPage = async (attempt: number): Promise<void> => {
    const isFirstAttempt = attempt === 0;
    if (isFirstAttempt) {
      await this.ensureOnProjectsPage();
      return;
    }

    await this.controls.gotoStable(projectsUrl);
    await this.page.waitForTimeout(retryReloadMilliseconds);
  };
}
