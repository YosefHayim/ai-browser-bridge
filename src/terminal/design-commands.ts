import { basename, join, resolve } from "node:path";
import type { Page } from "playwright";
import { z } from "zod";
import {
  type DesignCatalog,
  readDesignCatalog,
  setDesignModel,
} from "@/providers/design/design-composer.ts";
import {
  createDesignProject,
  type DesignConversationRead,
  type DesignConversationSummary,
  type DesignTurnOutcome,
  listDesignConversations,
  readDesignConversation,
  renameDesignConversation,
  sendDesignMessage,
  startNewDesignConversation,
} from "@/providers/design/design-conversation.ts";
import {
  type DesignFile,
  downloadDesignProject,
  listDesignFiles,
  putDesignFiles,
  removeDesignFiles,
} from "@/providers/design/design-files.ts";
import { type DesignState, readDesignState } from "@/providers/design/design-page.ts";
import {
  DESIGN_LINK_PERMISSIONS,
  DESIGN_SHARE_ACCESS,
  type DesignProject,
  deleteDesignProject,
  duplicateDesignProject,
  listDesignProjects,
  shareDesignProject,
  updateDesignProject,
} from "@/providers/design/design-projects.ts";
import { openDesignProjectTab } from "@/providers/design/design-tabs.ts";
import { downloadsDir } from "@/store/paths.ts";
import { createUsageError } from "./cli-failure.ts";
import { runWithDesignPage } from "./cli-operations.ts";
import type { DesignCmdOptions } from "./cli-types.ts";

const DEFAULT_TURN_TIMEOUT_SECONDS = 600;
const DEFAULT_READ_LIMIT = 20;
const DEFAULT_PROJECT_LIMIT = 50;

// The CLI edge: one Design page operation, then JSON or human lines. Errors reach the CLI boundary.
const runDesignCommand = async <T>(
  options: DesignCmdOptions,
  operation: (page: Page, repoRoot: string) => Promise<T>,
  formatText: (value: T) => string,
): Promise<void> => {
  const value = await runWithDesignPage(options, operation);

  const isJsonOutput = options.json === true;
  if (isJsonOutput) process.stdout.write(`${JSON.stringify(value)}\n`);
  else process.stdout.write(`${formatText(value)}\n`);
};

const requireOption = (value: string | undefined, flag: string): string => {
  const isFlagUnusable = value === undefined || value.trim().length === 0;
  if (isFlagUnusable) {
    throw createUsageError(`Missing ${flag}.`);
  }

  return value.trim();
};

const readPositiveIntegerOption = (value: string | undefined, fallback: number): number => {
  const isValueAbsent = value === undefined;
  if (isValueAbsent) return fallback;

  const parsed = Number(value.trim());
  const isNotPositiveInteger = !Number.isSafeInteger(parsed) || parsed <= 0;
  if (isNotPositiveInteger) {
    throw createUsageError(`Expected a positive whole number, got "${value}".`);
  }

  return parsed;
};

const listLocalPaths = (paths: readonly string[] | undefined): string[] => {
  const isPathsMissing = paths === undefined;
  if (isPathsMissing) return [];

  return paths.map((path) => resolve(path));
};

const readDesignSystemIdsOption = (options: DesignCmdOptions): readonly string[] | undefined => {
  const isNoneRequested = options.none === true;
  if (isNoneRequested) return [];

  return options.designSystem;
};

const turnOptions = (options: DesignCmdOptions) => ({
  model: options.model,
  effort: options.effort,
  attachments: listLocalPaths(options.attach),
  autoDecide: options.autoDecide === true,
  wait: options.wait !== false,
  timeoutMs: readPositiveIntegerOption(options.timeout, DEFAULT_TURN_TIMEOUT_SECONDS) * 1000,
});

const createTurnText = (outcome: DesignTurnOutcome): string => {
  const lines = [`${outcome.status}\tproject ${outcome.projectId}`];

  const hasConversationId = outcome.conversationId !== undefined;
  if (hasConversationId) lines.push(`conversation ${outcome.conversationId}`);

  const hasModel = outcome.model !== undefined;
  if (hasModel) lines.push(`model ${outcome.model}`);

  for (const message of outcome.messages) lines.push(`\n[${message.role}]\n${message.content}`);
  return lines.join("\n");
};

const createProjectsText = (projects: readonly DesignProject[]): string => {
  const isProjectsEmpty = projects.length === 0;
  if (isProjectsEmpty) return "No Claude Design projects.";

  return projects
    .map((project) => {
      let access = "";

      const hasProjectSharing = project.sharing !== undefined;
      if (hasProjectSharing) access = project.sharing.access;

      let star = "";

      if (project.favorite) star = "\t★";

      return `${project.id}\t${project.name}\t${access}${star}`;
    })
    .join("\n");
};

const createStateText = (state: DesignState): string => {
  const lines = [`page\t${state.page}\t${state.url}`];

  const hasProjectId = state.projectId !== undefined;
  if (hasProjectId) {
    let title = "";

    const hasProjectTitle = state.projectTitle !== undefined;
    if (hasProjectTitle) title = state.projectTitle;

    lines.push(`project\t${state.projectId}\t${title}`);
  }

  const hasModel = state.model !== undefined;
  if (hasModel) lines.push(`model\t${state.model}`);

  lines.push(`busy\t${state.busy}`);
  for (const tab of state.tabs) lines.push(`tab\t${tab.busy ? "busy" : "idle"}\t${tab.url}`);
  lines.push(`actions\t${state.actions.join(", ")}`);
  lines.push(`manual\t${state.manual.join(", ")}`);
  return lines.join("\n");
};

const createCatalogText = (catalog: DesignCatalog): string => {
  const lines = [`Templates: ${catalog.templates.join(", ")}`, "Models:"];
  for (const model of catalog.models) {
    let marker = "";

    if (model.isDefault) marker = " (default)";

    lines.push(`  ${model.label}${marker}\t${model.id}\teffort: ${model.efforts.join(", ")}`);
  }
  lines.push("Design systems:");
  for (const designSystem of catalog.designSystems) {
    let marker = "";

    if (designSystem.isOrgDefault) marker = " (org default)";

    lines.push(`  ${designSystem.id}\t${designSystem.name}${marker}`);
  }
  return lines.join("\n");
};

const createConversationLines = (conversations: readonly DesignConversationSummary[]): string[] => {
  return conversations.map((conversation) => {
    let marker = " ";

    if (conversation.active) marker = "*";

    let state = "";

    const isConversationClosed = !conversation.open;
    if (isConversationClosed) state = "\tclosed";

    return `${marker} ${conversation.id}\t${conversation.title}\t${conversation.messageCount} messages${state}`;
  });
};

const createReadText = (
  read: DesignConversationRead & { readonly conversations: DesignConversationSummary[] },
): string => {
  const lines = createConversationLines(read.conversations);
  lines.push(`\nConversation ${read.conversation.id} — ${read.conversation.title}`);
  for (const message of read.messages) lines.push(`\n[${message.role}]\n${message.content}`);
  return lines.join("\n");
};

const createFilesText = (files: readonly DesignFile[]): string => {
  const isFilesEmpty = files.length === 0;
  if (isFilesEmpty) return "No files.";

  return files
    .map((file) => {
      let size = "";

      const hasFileSize = file.size !== undefined;
      if (hasFileSize) size = `${file.size} B`;

      return `${file.path}\t${file.kind}\t${size}`;
    })
    .join("\n");
};

const createLinesText = (lines: readonly string[]): string => lines.join("\n");

const readProjectDownloadDir = (options: DesignCmdOptions, repoRoot: string, projectId: string) => {
  const hasOut = options.out !== undefined;
  if (hasOut) return resolve(options.out);

  return join(downloadsDir(repoRoot), "design", basename(projectId));
};

export const runDesignState = (options: DesignCmdOptions): Promise<void> => {
  return runDesignCommand(options, (page) => readDesignState(page), createStateText);
};

export const runDesignProjects = (options: DesignCmdOptions): Promise<void> => {
  let kind: "projects" | "design-systems" = "projects";

  const isDesignSystemsRequested = options.designSystems === true;
  if (isDesignSystemsRequested) kind = "design-systems";

  const limit = readPositiveIntegerOption(options.limit, DEFAULT_PROJECT_LIMIT);
  return runDesignCommand(
    options,
    (page) => listDesignProjects(page, { kind, query: options.query, limit }),
    createProjectsText,
  );
};

export const runDesignCatalog = (options: DesignCmdOptions): Promise<void> => {
  return runDesignCommand(options, (page) => readDesignCatalog(page), createCatalogText);
};

export const runDesignModel = (options: DesignCmdOptions): Promise<void> => {
  const isModelChoiceEmpty = options.model == null && options.effort == null;
  if (isModelChoiceEmpty) {
    throw createUsageError("Pass --model <label> and/or --effort <level>.");
  }

  return runDesignCommand(
    options,
    (page) =>
      setDesignModel(page, {
        projectId: options.project,
        model: options.model,
        effort: options.effort,
      }),
    (chosen) => `model\t${chosen.model}`,
  );
};

export const runDesignOpen = (options: DesignCmdOptions): Promise<void> => {
  const projectId = requireOption(options.project, "--project");
  return runDesignCommand(
    options,
    async (page) => ({ projectId, url: (await openDesignProjectTab(page, projectId)).url() }),
    (opened) => opened.url,
  );
};

export const runDesignCreate = (options: DesignCmdOptions): Promise<void> => {
  return runDesignCommand(
    options,
    (page) =>
      createDesignProject(page, {
        name: options.name,
        prompt: options.prompt,
        template: options.template,
        designSystemIds: readDesignSystemIdsOption(options),
        ...turnOptions(options),
      }),
    createTurnText,
  );
};

export const runDesignSend = (options: DesignCmdOptions): Promise<void> => {
  const projectId = requireOption(options.project, "--project");
  const message = requireOption(options.message, "--message");
  return runDesignCommand(
    options,
    (page) =>
      sendDesignMessage(page, {
        projectId,
        message,
        conversationId: options.conversation,
        designSystemIds: readDesignSystemIdsOption(options),
        ...turnOptions(options),
      }),
    createTurnText,
  );
};

export const runDesignRead = (options: DesignCmdOptions): Promise<void> => {
  const projectId = requireOption(options.project, "--project");
  const limit = readPositiveIntegerOption(options.limit, DEFAULT_READ_LIMIT);
  return runDesignCommand(
    options,
    async (page) => ({
      conversations: await listDesignConversations(page, projectId),
      ...(await readDesignConversation(page, {
        projectId,
        conversationId: options.conversation,
        limit,
      })),
    }),
    createReadText,
  );
};

export const runDesignNewConversation = (options: DesignCmdOptions): Promise<void> => {
  const projectId = requireOption(options.project, "--project");
  return runDesignCommand(
    options,
    async (page) => ({
      projectId,
      conversationId: await startNewDesignConversation(page, projectId),
    }),
    (created) => created.conversationId,
  );
};

export const runDesignRenameConversation = (options: DesignCmdOptions): Promise<void> => {
  const projectId = requireOption(options.project, "--project");
  const conversationId = requireOption(options.conversation, "--conversation");
  const title = requireOption(options.title, "--title");
  return runDesignCommand(
    options,
    async (page) => {
      await renameDesignConversation(page, { projectId, conversationId, title });
      return { projectId, conversationId, title };
    },
    (renamed) => `Renamed ${renamed.conversationId} to "${renamed.title}".`,
  );
};

const runProjectUpdate = (
  options: DesignCmdOptions,
  changes: { readonly name?: string; readonly favorite?: boolean },
): Promise<void> => {
  const projectId = requireOption(options.project, "--project");
  return runDesignCommand(
    options,
    (page) =>
      updateDesignProject(page, {
        projectId,
        ...changes,
        designSystemIds: readDesignSystemIdsOption(options),
      }),
    (project) =>
      `${project.id}\t${project.name}\tdesign systems: ${project.designSystemIds.length}`,
  );
};

export const runDesignRename = (options: DesignCmdOptions): Promise<void> => {
  return runProjectUpdate(options, { name: requireOption(options.name, "--name") });
};

export const runDesignFavorite = (options: DesignCmdOptions): Promise<void> => {
  return runProjectUpdate(options, { favorite: options.off !== true });
};

export const runDesignUseDesignSystems = (options: DesignCmdOptions): Promise<void> => {
  const isSystemIdsMissing = readDesignSystemIdsOption(options) === undefined;
  if (isSystemIdsMissing) {
    throw createUsageError("Pass --design-system <id...> or --none.");
  }

  return runProjectUpdate(options, {});
};

export const runDesignDuplicate = (options: DesignCmdOptions): Promise<void> => {
  const projectId = requireOption(options.project, "--project");
  return runDesignCommand(
    options,
    async (page) => ({ projectId: await duplicateDesignProject(page, projectId) }),
    (duplicated) => duplicated.projectId,
  );
};

export const runDesignDelete = (options: DesignCmdOptions): Promise<void> => {
  const projectId = requireOption(options.project, "--project");

  const isYesNotRequested = options.yes !== true;
  if (isYesNotRequested) {
    throw createUsageError(`Refusing to delete ${projectId} without --yes (permanent).`);
  }

  return runDesignCommand(
    options,
    async (page) => {
      await deleteDesignProject(page, projectId);
      return { projectId, deleted: true };
    },
    (deleted) => `Deleted ${deleted.projectId}.`,
  );
};

export const runDesignFiles = (options: DesignCmdOptions): Promise<void> => {
  const projectId = requireOption(options.project, "--project");
  return runDesignCommand(options, (page) => listDesignFiles(page, projectId), createFilesText);
};

export const runDesignPut = (options: DesignCmdOptions): Promise<void> => {
  const projectId = requireOption(options.project, "--project");
  const uploads = listLocalPaths(options.file).map((localPath) => {
    let path = basename(localPath);

    const hasDir = options.dir !== undefined;
    if (hasDir) path = `${options.dir.replace(/\/+$/u, "")}/${path}`;

    return { localPath, path };
  });

  const isUploadsEmpty = uploads.length === 0;
  if (isUploadsEmpty) throw createUsageError("Pass --file <path...>.");

  return runDesignCommand(
    options,
    (page) => putDesignFiles(page, { projectId, uploads }),
    (written) => createLinesText(written.map((file) => `put\t${file.path}`)),
  );
};

export const runDesignRemove = (options: DesignCmdOptions): Promise<void> => {
  const projectId = requireOption(options.project, "--project");

  const paths = options.path;
  const isPathsBlank = paths === undefined || paths.length === 0;
  if (isPathsBlank) {
    throw createUsageError("Pass --path <projectPath...>.");
  }

  const isYesNotRequested = options.yes !== true;
  if (isYesNotRequested) {
    throw createUsageError(`Refusing to delete ${paths.length} file(s) without --yes.`);
  }

  return runDesignCommand(
    options,
    (page) => removeDesignFiles(page, { projectId, paths }),
    (removed) => createLinesText(removed.map((file) => `removed\t${file.path}\t${file.deleted}`)),
  );
};

export const runDesignDownload = (options: DesignCmdOptions): Promise<void> => {
  const projectId = requireOption(options.project, "--project");
  return runDesignCommand(
    options,
    async (page, repoRoot) => ({
      files: await downloadDesignProject(page, {
        projectId,
        format: "files",
        paths: options.path,
        outDir: readProjectDownloadDir(options, repoRoot, projectId),
      }),
    }),
    (downloaded) => createLinesText(downloaded.files),
  );
};

export const runDesignExport = (options: DesignCmdOptions): Promise<void> => {
  const projectId = requireOption(options.project, "--project");
  return runDesignCommand(
    options,
    async (page, repoRoot) => ({
      files: await downloadDesignProject(page, {
        projectId,
        format: "zip",
        paths: undefined,
        outDir: readProjectDownloadDir(options, repoRoot, projectId),
      }),
    }),
    (exported) => createLinesText(exported.files),
  );
};

export const runDesignShare = (options: DesignCmdOptions): Promise<void> => {
  const projectId = requireOption(options.project, "--project");
  let access: (typeof DESIGN_SHARE_ACCESS)[number];
  let linkPermission: (typeof DESIGN_LINK_PERMISSIONS)[number] | undefined;
  try {
    access = z.enum(DESIGN_SHARE_ACCESS).parse(options.access);
    linkPermission = z.enum(DESIGN_LINK_PERMISSIONS).optional().parse(options.permission);
  } catch {
    throw createUsageError(
      `Use --access ${DESIGN_SHARE_ACCESS.join("|")} and --permission ${DESIGN_LINK_PERMISSIONS.join("|")}.`,
    );
  }
  return runDesignCommand(
    options,
    (page) => shareDesignProject(page, { projectId, access, linkPermission }),
    (shared) => {
      let sharing = "";

      const hasSharedSharing = shared.sharing !== undefined;
      if (hasSharedSharing) {
        sharing = `${shared.sharing.access} (${shared.sharing.linkPermission})`;
      }

      return `${sharing}\t${shared.url}`;
    },
  );
};
