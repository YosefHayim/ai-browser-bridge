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
  type DesignTurnReport,
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
import { type DesignStatus, readDesignStatus } from "@/providers/design/design-page.ts";
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
import { readDownloadsDirectory } from "@/store/paths.ts";
import { createUsageError } from "./cli-failure.ts";
import { runWithDesignPage } from "./cli-operations.ts";
import type { DesignCommandSettings } from "./cli-types.ts";

const DEFAULT_TURN_TIMEOUT_SECONDS = 600;
const DEFAULT_READ_LIMIT = 20;
const DEFAULT_PROJECT_LIMIT = 50;

// The CLI edge: one Design page operation, then JSON or human lines. Errors reach the CLI boundary.
const runDesignCommand = async <T>(
  settings: DesignCommandSettings,
  operation: (page: Page, repoRoot: string) => Promise<T>,
  formatString: (field: T) => string,
): Promise<void> => {
  const designPageAnswer = await runWithDesignPage(settings, operation);

  const isDocumentPrintout = settings.json === true;
  if (isDocumentPrintout) process.stdout.write(`${JSON.stringify(designPageAnswer)}\n`);
  else process.stdout.write(`${formatString(designPageAnswer)}\n`);
};

const requireOption = (field: string | undefined, flag: string): string => {
  const isFlagUnusable = field == null || field.trim().length === 0;
  if (isFlagUnusable) {
    throw createUsageError(`Missing ${flag}.`);
  }

  return field.trim();
};

const readPositiveIntegerOption = (field: string | undefined, fallback: number): number => {
  const isFieldAbsent = field == null;
  if (isFieldAbsent) return fallback;

  const parsed = Number(field.trim());
  const isNotPositiveInteger = !Number.isSafeInteger(parsed) || parsed <= 0;
  if (isNotPositiveInteger) {
    throw createUsageError(`Expected a positive whole number, got "${field}".`);
  }

  return parsed;
};

const listLocalPaths = (paths: readonly string[] | undefined): string[] => {
  const isPathsMissing = paths == null;
  if (isPathsMissing) return [];

  return paths.map((path) => resolve(path));
};

const readDesignSystemIdsOption = (
  settings: DesignCommandSettings,
): readonly string[] | undefined => {
  const isNoneRequested = settings.none === true;
  if (isNoneRequested) return [];

  return settings.designSystem;
};

const turnSettings = (settings: DesignCommandSettings) => ({
  model: settings.model,
  effort: settings.effort,
  attachments: listLocalPaths(settings.attach),
  autoDecide: settings.autoDecide === true,
  wait: settings.wait !== false,
  timeoutMs: readPositiveIntegerOption(settings.timeout, DEFAULT_TURN_TIMEOUT_SECONDS) * 1000,
});

const createTurnPrintout = (verdict: DesignTurnReport): string => {
  const lines = [`${verdict.status}\tproject ${verdict.projectId}`];

  const hasConversationId = verdict.conversationId != null;
  if (hasConversationId) lines.push(`conversation ${verdict.conversationId}`);

  const hasModel = verdict.model != null;
  if (hasModel) lines.push(`model ${verdict.model}`);

  for (const message of verdict.messages) lines.push(`\n[${message.role}]\n${message.content}`);
  return lines.join("\n");
};

const createProjectsPrintout = (projects: readonly DesignProject[]): string => {
  const isProjectsEmpty = projects.length === 0;
  if (isProjectsEmpty) return "No Claude Design projects.";

  return projects
    .map((project) => {
      let access = "";

      const hasProjectSharing = project.sharing != null;
      if (hasProjectSharing) access = project.sharing.access;

      let star = "";

      if (project.favorite) star = "\t★";

      return `${project.id}\t${project.name}\t${access}${star}`;
    })
    .join("\n");
};

const createStatusPrintout = (status: DesignStatus): string => {
  const lines = [`page\t${status.page}\t${status.url}`];

  const hasProjectId = status.projectId != null;
  if (hasProjectId) {
    let title = "";

    const hasProjectTitle = status.projectTitle != null;
    if (hasProjectTitle) title = status.projectTitle;

    lines.push(`project\t${status.projectId}\t${title}`);
  }

  const hasModel = status.model != null;
  if (hasModel) lines.push(`model\t${status.model}`);

  lines.push(`busy\t${status.busy}`);
  for (const tab of status.tabs) lines.push(`tab\t${tab.busy ? "busy" : "idle"}\t${tab.url}`);
  lines.push(`actions\t${status.actions.join(", ")}`);
  lines.push(`manual\t${status.manual.join(", ")}`);
  return lines.join("\n");
};

const createCatalogPrintout = (catalog: DesignCatalog): string => {
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

    let status = "";

    const isConversationClosed = !conversation.open;
    if (isConversationClosed) status = "\tclosed";

    return `${marker} ${conversation.id}\t${conversation.title}\t${conversation.messageCount} messages${status}`;
  });
};

const createReadPrintout = (
  read: DesignConversationRead & { readonly conversations: DesignConversationSummary[] },
): string => {
  const lines = createConversationLines(read.conversations);
  lines.push(`\nConversation ${read.conversation.id} — ${read.conversation.title}`);
  for (const message of read.messages) lines.push(`\n[${message.role}]\n${message.content}`);
  return lines.join("\n");
};

const createFilesPrintout = (files: readonly DesignFile[]): string => {
  const isFilesEmpty = files.length === 0;
  if (isFilesEmpty) return "No files.";

  return files
    .map((file) => {
      let size = "";

      const hasFileSize = file.size != null;
      if (hasFileSize) size = `${file.size} B`;

      return `${file.path}\t${file.kind}\t${size}`;
    })
    .join("\n");
};

const createLinesPrintout = (lines: readonly string[]): string => lines.join("\n");

const readProjectDownloadDir = (
  settings: DesignCommandSettings,
  repoRoot: string,
  projectId: string,
) => {
  const hasOut = settings.out != null;
  if (hasOut) return resolve(settings.out);

  return join(readDownloadsDirectory(repoRoot), "design", basename(projectId));
};

export const runDesignStatus = (settings: DesignCommandSettings): Promise<void> => {
  return runDesignCommand(settings, (page) => readDesignStatus(page), createStatusPrintout);
};

export const runDesignProjects = (settings: DesignCommandSettings): Promise<void> => {
  let kind: "projects" | "design-systems" = "projects";

  const isDesignSystemsRequested = settings.designSystems === true;
  if (isDesignSystemsRequested) kind = "design-systems";

  const limit = readPositiveIntegerOption(settings.limit, DEFAULT_PROJECT_LIMIT);
  return runDesignCommand(
    settings,
    (page) => listDesignProjects(page, { kind, query: settings.query, limit }),
    createProjectsPrintout,
  );
};

export const runDesignCatalog = (settings: DesignCommandSettings): Promise<void> => {
  return runDesignCommand(settings, (page) => readDesignCatalog(page), createCatalogPrintout);
};

export const runDesignModel = (settings: DesignCommandSettings): Promise<void> => {
  const isModelChoiceEmpty = settings.model == null && settings.effort == null;
  if (isModelChoiceEmpty) {
    throw createUsageError("Pass --model <label> and/or --effort <level>.");
  }

  return runDesignCommand(
    settings,
    (page) =>
      setDesignModel(page, {
        projectId: settings.project,
        model: settings.model,
        effort: settings.effort,
      }),
    (chosen) => `model\t${chosen.model}`,
  );
};

export const runDesignOpen = (settings: DesignCommandSettings): Promise<void> => {
  const projectId = requireOption(settings.project, "--project");
  return runDesignCommand(
    settings,
    async (page) => ({ projectId, url: (await openDesignProjectTab(page, projectId)).url() }),
    (opened) => opened.url,
  );
};

export const runDesignCreate = (settings: DesignCommandSettings): Promise<void> => {
  return runDesignCommand(
    settings,
    (page) =>
      createDesignProject(page, {
        name: settings.name,
        prompt: settings.prompt,
        template: settings.template,
        designSystemIds: readDesignSystemIdsOption(settings),
        ...turnSettings(settings),
      }),
    createTurnPrintout,
  );
};

export const runDesignSend = (settings: DesignCommandSettings): Promise<void> => {
  const projectId = requireOption(settings.project, "--project");
  const message = requireOption(settings.message, "--message");
  return runDesignCommand(
    settings,
    (page) =>
      sendDesignMessage(page, {
        projectId,
        message,
        conversationId: settings.conversation,
        designSystemIds: readDesignSystemIdsOption(settings),
        ...turnSettings(settings),
      }),
    createTurnPrintout,
  );
};

export const runDesignRead = (settings: DesignCommandSettings): Promise<void> => {
  const projectId = requireOption(settings.project, "--project");
  const limit = readPositiveIntegerOption(settings.limit, DEFAULT_READ_LIMIT);
  return runDesignCommand(
    settings,
    async (page) => ({
      conversations: await listDesignConversations(page, projectId),
      ...(await readDesignConversation(page, {
        projectId,
        conversationId: settings.conversation,
        limit,
      })),
    }),
    createReadPrintout,
  );
};

export const runDesignNewConversation = (settings: DesignCommandSettings): Promise<void> => {
  const projectId = requireOption(settings.project, "--project");
  return runDesignCommand(
    settings,
    async (page) => ({
      projectId,
      conversationId: await startNewDesignConversation(page, projectId),
    }),
    (created) => created.conversationId,
  );
};

export const runDesignRenameConversation = (settings: DesignCommandSettings): Promise<void> => {
  const projectId = requireOption(settings.project, "--project");
  const conversationId = requireOption(settings.conversation, "--conversation");
  const title = requireOption(settings.title, "--title");
  return runDesignCommand(
    settings,
    async (page) => {
      await renameDesignConversation(page, { projectId, conversationId, title });
      return { projectId, conversationId, title };
    },
    (renamed) => `Renamed ${renamed.conversationId} to "${renamed.title}".`,
  );
};

const runProjectUpdate = (
  settings: DesignCommandSettings,
  changes: { readonly name?: string; readonly favorite?: boolean },
): Promise<void> => {
  const projectId = requireOption(settings.project, "--project");
  return runDesignCommand(
    settings,
    (page) =>
      updateDesignProject(page, {
        projectId,
        ...changes,
        designSystemIds: readDesignSystemIdsOption(settings),
      }),
    (project) =>
      `${project.id}\t${project.name}\tdesign systems: ${project.designSystemIds.length}`,
  );
};

export const runDesignRename = (settings: DesignCommandSettings): Promise<void> => {
  return runProjectUpdate(settings, { name: requireOption(settings.name, "--name") });
};

export const runDesignFavorite = (settings: DesignCommandSettings): Promise<void> => {
  return runProjectUpdate(settings, { favorite: settings.off !== true });
};

export const runDesignUseDesignSystems = (settings: DesignCommandSettings): Promise<void> => {
  const systemIds = readDesignSystemIdsOption(settings);
  const isSystemIdsMissing = systemIds == null;
  if (isSystemIdsMissing) {
    throw createUsageError("Pass --design-system <id...> or --none.");
  }

  return runProjectUpdate(settings, {});
};

export const runDesignDuplicate = (settings: DesignCommandSettings): Promise<void> => {
  const projectId = requireOption(settings.project, "--project");
  return runDesignCommand(
    settings,
    async (page) => ({ projectId: await duplicateDesignProject(page, projectId) }),
    (duplicated) => duplicated.projectId,
  );
};

export const runDesignDelete = (settings: DesignCommandSettings): Promise<void> => {
  const projectId = requireOption(settings.project, "--project");

  const isYesNotRequested = settings.yes !== true;
  if (isYesNotRequested) {
    throw createUsageError(`Refusing to delete ${projectId} without --yes (permanent).`);
  }

  return runDesignCommand(
    settings,
    async (page) => {
      await deleteDesignProject(page, projectId);
      return { projectId, deleted: true };
    },
    (deleted) => `Deleted ${deleted.projectId}.`,
  );
};

export const runDesignFiles = (settings: DesignCommandSettings): Promise<void> => {
  const projectId = requireOption(settings.project, "--project");
  return runDesignCommand(
    settings,
    (page) => listDesignFiles(page, projectId),
    createFilesPrintout,
  );
};

export const runDesignPut = (settings: DesignCommandSettings): Promise<void> => {
  const projectId = requireOption(settings.project, "--project");
  const uploads = listLocalPaths(settings.file).map((localPath) => {
    let path = basename(localPath);

    const hasDir = settings.dir != null;
    if (hasDir) path = `${settings.dir.replace(/\/+$/u, "")}/${path}`;

    return { localPath, path };
  });

  const isUploadsEmpty = uploads.length === 0;
  if (isUploadsEmpty) throw createUsageError("Pass --file <path...>.");

  return runDesignCommand(
    settings,
    (page) => putDesignFiles(page, { projectId, uploads }),
    (written) => createLinesPrintout(written.map((file) => `put\t${file.path}`)),
  );
};

export const runDesignRemove = (settings: DesignCommandSettings): Promise<void> => {
  const projectId = requireOption(settings.project, "--project");

  const paths = settings.path;
  const isPathsBlank = paths == null || paths.length === 0;
  if (isPathsBlank) {
    throw createUsageError("Pass --path <projectPath...>.");
  }

  const isYesNotRequested = settings.yes !== true;
  if (isYesNotRequested) {
    throw createUsageError(`Refusing to delete ${paths.length} file(s) without --yes.`);
  }

  return runDesignCommand(
    settings,
    (page) => removeDesignFiles(page, { projectId, paths }),
    (removed) =>
      createLinesPrintout(removed.map((file) => `removed\t${file.path}\t${file.deleted}`)),
  );
};

export const runDesignDownload = (settings: DesignCommandSettings): Promise<void> => {
  const projectId = requireOption(settings.project, "--project");
  return runDesignCommand(
    settings,
    async (page, repoRoot) => ({
      files: await downloadDesignProject(page, {
        projectId,
        format: "files",
        paths: settings.path,
        outDir: readProjectDownloadDir(settings, repoRoot, projectId),
      }),
    }),
    (downloaded) => createLinesPrintout(downloaded.files),
  );
};

export const runDesignExport = (settings: DesignCommandSettings): Promise<void> => {
  const projectId = requireOption(settings.project, "--project");
  return runDesignCommand(
    settings,
    async (page, repoRoot) => ({
      files: await downloadDesignProject(page, {
        projectId,
        format: "zip",
        paths: undefined,
        outDir: readProjectDownloadDir(settings, repoRoot, projectId),
      }),
    }),
    (exported) => createLinesPrintout(exported.files),
  );
};

export const runDesignShare = (settings: DesignCommandSettings): Promise<void> => {
  const projectId = requireOption(settings.project, "--project");
  let access: (typeof DESIGN_SHARE_ACCESS)[number];
  let linkPermission: (typeof DESIGN_LINK_PERMISSIONS)[number] | undefined;
  try {
    access = z.enum(DESIGN_SHARE_ACCESS).parse(settings.access);
    linkPermission = z.enum(DESIGN_LINK_PERMISSIONS).optional().parse(settings.permission);
  } catch {
    throw createUsageError(
      `Use --access ${DESIGN_SHARE_ACCESS.join("|")} and --permission ${DESIGN_LINK_PERMISSIONS.join("|")}.`,
    );
  }
  return runDesignCommand(
    settings,
    (page) => shareDesignProject(page, { projectId, access, linkPermission }),
    (shared) => {
      let sharing = "";

      const hasSharedSharing = shared.sharing != null;
      if (hasSharedSharing) {
        sharing = `${shared.sharing.access} (${shared.sharing.linkPermission})`;
      }

      return `${sharing}\t${shared.url}`;
    },
  );
};
